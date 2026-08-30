"""
A yard session is bounded, and re-checked against Firebase when it can be.

The satellite verified the token once at sign-in and then trusted the Flask
session indefinitely. Mission Control re-verifies on every request with
checkRevoked, so removing an operator there took effect at once and did nothing
here: a revoked operator kept the yard console, including Send.

It cannot just copy Mission Control - this console exists to work offline - so
the rules are asymmetric on purpose, and that asymmetry is what these test.
"""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import operator_console  # noqa: E402
from operator_console import (  # noqa: E402
    SESSION_MAX_AGE,
    OFFLINE_OPERATOR,
    _session_expired,
    _still_authorised,
)


def _op(**overrides):
    now = time.time()
    op = {
        'uid': 'op-1',
        'email': 'op@rover.com',
        'role': 'operator',
        'signed_in_at': now,
        # Old enough that a re-check is due.
        'checked_at': 0,
    }
    op.update(overrides)
    return op


class FakeUser:
    def __init__(self, role='operator', disabled=False):
        self.custom_claims = {'role': role} if role else {}
        self.disabled = disabled


@pytest.fixture(autouse=True)
def flask_session(monkeypatch):
    """current_operator writes back to the session; give it somewhere to write."""
    class Session(dict):
        modified = False
    s = Session()
    monkeypatch.setattr(operator_console, 'session', s)
    return s


def _firebase_returns(monkeypatch, user=None, error=None):
    class FakeAuth:
        @staticmethod
        def get_user(uid, app=None):
            if error:
                raise error
            return user

    import types
    fake = types.ModuleType('firebase_admin')
    fake.auth = FakeAuth
    monkeypatch.setitem(sys.modules, 'firebase_admin', fake)
    monkeypatch.setattr(operator_console, '_init_firebase', lambda: object())


class TestTheSessionIsBounded:
    def test_a_fresh_session_has_not_expired(self):
        assert _session_expired(_op(), time.time()) is False

    def test_a_session_older_than_the_maximum_has(self):
        old = _op(signed_in_at=time.time() - SESSION_MAX_AGE - 1)
        assert _session_expired(old, time.time()) is True

    def test_a_session_with_no_timestamp_is_treated_as_expired(self):
        # Sessions minted before this existed carry no signed_in_at. Expiring
        # them costs one re-login; trusting them forever is the bug.
        stale = _op()
        del stale['signed_in_at']
        assert _session_expired(stale, time.time()) is True


class TestRevocationTakesEffect:
    def test_an_operator_whose_role_was_removed_loses_the_session(self, monkeypatch):
        """The case /operator/team's Remove button creates."""
        _firebase_returns(monkeypatch, user=FakeUser(role=None))
        assert _still_authorised(_op(), time.time()) is False

    def test_a_disabled_account_loses_the_session(self, monkeypatch):
        _firebase_returns(monkeypatch, user=FakeUser(disabled=True))
        assert _still_authorised(_op(), time.time()) is False

    def test_a_still_valid_operator_keeps_it(self, monkeypatch):
        _firebase_returns(monkeypatch, user=FakeUser(role='operator'))
        assert _still_authorised(_op(), time.time()) is True

    def test_a_promotion_is_picked_up_without_re_login(self, monkeypatch):
        _firebase_returns(monkeypatch, user=FakeUser(role='admin'))
        operator = _op(role='operator')

        assert _still_authorised(operator, time.time()) is True
        assert operator['role'] == 'admin'


class TestOfflineKeepsWorking:
    def test_an_unreachable_firebase_does_not_end_the_session(self, monkeypatch):
        """The whole reason this console exists.

        A check that failed closed would lock an operator out of a rover
        because venue wifi dropped. SESSION_MAX_AGE is what bounds a revoked
        session instead.
        """
        _firebase_returns(monkeypatch, error=ConnectionError('no internet'))
        assert _still_authorised(_op(), time.time()) is True

    def test_the_offline_stub_is_never_checked(self, monkeypatch):
        def explode(*a, **k):
            raise AssertionError('must not call Firebase for the offline stub')
        monkeypatch.setattr(operator_console, '_init_firebase', explode)

        assert _still_authorised(dict(OFFLINE_OPERATOR), time.time()) is True


class TestTheCheckIsPaced:
    def test_a_recently_checked_session_does_not_call_firebase(self, monkeypatch):
        # One Firebase read per request would be a bill and a latency cost on
        # every page of the console.
        def explode(*a, **k):
            raise AssertionError('should not re-check this soon')
        monkeypatch.setattr(operator_console, '_init_firebase', explode)

        just_checked = _op(checked_at=time.time())
        assert _still_authorised(just_checked, time.time()) is True
