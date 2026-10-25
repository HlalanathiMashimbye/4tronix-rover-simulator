"""The run station sends a handed-over mission by itself only when Mission
Control signed it.

The signature is checked here, in the satellite's Python, against the format
Mission Control's HmacHandoffSigner.ts writes. mission_handoff_vector.json
pins that format: this file and HmacHandoffSigner.test.ts both check against
it, so neither side can change it alone.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import mission_handoff
import web_server

with open(os.path.join(os.path.dirname(__file__), 'mission_handoff_vector.json'), encoding='utf-8') as f:
    VECTOR = json.load(f)

SECRET = VECTOR['secret']
NOW = VECTOR['expires'] - 60


@pytest.fixture(autouse=True)
def _fresh_signatures():
    mission_handoff._used.clear()
    yield
    mission_handoff._used.clear()


def check(**over):
    args = dict(secret=SECRET, yard_id=VECTOR['yardId'], mission_id=VECTOR['missionId'],
                code=VECTOR['code'], expires=VECTOR['expires'], sig=VECTOR['signature'], now=NOW)
    args.update(over)
    return mission_handoff.verify(**args)


def test_it_signs_exactly_as_mission_control_does():
    assert mission_handoff.signature(SECRET, VECTOR['yardId'], VECTOR['missionId'],
                                     VECTOR['expires'], VECTOR['code']) == VECTOR['signature']


def test_mission_controls_signature_verifies_once():
    assert check() == (True, None)
    # A reload, or the same link opened again later, waits for Send.
    assert check() == (False, 'already used')


@pytest.mark.parametrize('field,value', [
    ('code', 'rover.forward(100)'),
    ('mission_id', 'another-mission'),
    ('yard_id', 'another-yard'),
    ('secret', 'a-different-secret-of-some-length'),
    ('sig', '0' * 64),
])
def test_any_change_to_what_was_signed_fails(field, value):
    assert check(**{field: value}) == (False, 'signature does not match')


def test_an_expired_signature_fails():
    assert check(now=VECTOR['expires'] + 1) == (False, 'expired')


def test_an_expiry_far_in_the_future_fails():
    assert check(now=VECTOR['expires'] - 16 * 60)[0] is False


def test_with_no_shared_secret_nothing_verifies():
    assert check(secret='')[0] is False


def test_a_missing_expiry_fails():
    assert check(expires=None) == (False, 'no expiry')


def post_verify(monkeypatch, secret=SECRET, yard='curiosity', **body):
    import satellite_identity
    import youtube_upload
    monkeypatch.setattr(youtube_upload, 'shared_secret', lambda: secret)
    monkeypatch.setattr(satellite_identity, 'yard_id', lambda: yard)
    monkeypatch.setattr(mission_handoff.time, 'time', lambda: NOW)
    payload = {'missionId': VECTOR['missionId'], 'code': VECTOR['code'],
               'expires': VECTOR['expires'], 'signature': VECTOR['signature'], **body}
    return web_server.app.test_client().post('/api/handoff/verify', json=payload).get_json()


def test_the_run_station_is_told_a_signed_handoff_verified(monkeypatch):
    assert post_verify(monkeypatch)['verified'] is True


def test_a_signature_for_another_yard_is_refused_here(monkeypatch):
    """The satellite checks against its own yard, not the one the link names."""
    assert post_verify(monkeypatch, yard='elsewhere')['verified'] is False


def test_an_unsigned_handoff_is_not_verified(monkeypatch):
    assert post_verify(monkeypatch, signature='')['verified'] is False
