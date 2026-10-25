"""The automatic-upload secret, set from the Settings page.

It used to be a line in a .env on the Pi. It is set in the Mission Control
dialog now, and two things follow from the console having no sign-in: the page
can never read it back, and it is only ever sent to the Mission Control it was
entered for. Otherwise anyone on the yard's wifi could point the yard at their
own server and receive the secret in the next upload's headers.
"""

import pytest

import web_server
import youtube_upload

SECRET = 'S' * 24 + 'x9Kq-Lw2_Zp7Rt4Vb8Nm3Jh6'  # 48, like Terraform's
SECRET_API = '/operator/api/config/upload-secret'
TUNABLES = '/operator/api/config/tunables'


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv('YOUTUBE_UPLOAD_INGEST_SECRET', raising=False)
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    monkeypatch.setattr(youtube_upload, 'kick', lambda: None)
    web_server.app.config['TESTING'] = True
    with web_server.app.test_client() as client:
        yield client


def status(client):
    return client.get(SECRET_API).get_json()


def test_with_none_set_automatic_upload_is_off(client):
    assert status(client) == {'configured': False, 'source': None, 'issuedFor': None, 'otherAddress': False}
    assert youtube_upload._secret() == ''


def test_a_saved_secret_is_used_and_never_shown(client):
    resp = client.post(SECRET_API, json={'secret': f'  {SECRET}  '})

    assert resp.status_code == 200
    assert resp.get_json()['configured'] is True
    assert youtube_upload._secret() == SECRET
    # Nothing the page can fetch carries it.
    for path in (SECRET_API, TUNABLES, '/api/status', '/settings'):
        assert SECRET not in client.get(path).get_data(as_text=True), path


def test_it_is_only_sent_to_the_mission_control_it_was_entered_for(client):
    client.post(SECRET_API, json={'secret': SECRET})

    client.post(TUNABLES, json={'missionControlUrl': 'https://somewhere-else.example'})

    assert youtube_upload._secret() == ''
    assert status(client)['otherAddress'] is True
    assert status(client)['issuedFor'] == 'https://marsyard.sapient.rocks'

    # Pointed back, it is in force again without being typed twice.
    client.post(TUNABLES, json={'missionControlUrl': 'marsyard.sapient.rocks'})
    assert youtube_upload._secret() == SECRET


def test_one_from_the_environment_is_tied_the_same_way(client, monkeypatch):
    monkeypatch.setenv('YOUTUBE_UPLOAD_INGEST_SECRET', SECRET)
    monkeypatch.setenv('MISSION_CONTROL_URL', 'https://mission.example/')

    assert status(client)['configured'] is True
    assert status(client)['source'] == 'environment'

    client.post(TUNABLES, json={'missionControlUrl': 'https://somewhere-else.example'})
    assert youtube_upload._secret() == ''


@pytest.mark.parametrize('typed', ['short', 'has a space in it but is long enough'])
def test_something_that_cannot_be_the_secret_is_refused(client, typed):
    resp = client.post(SECRET_API, json={'secret': typed})

    assert resp.status_code == 400
    assert status(client)['configured'] is False


def test_an_empty_one_removes_it(client):
    client.post(SECRET_API, json={'secret': SECRET})

    client.post(SECRET_API, json={'secret': ''})

    assert status(client)['configured'] is False
    assert youtube_upload._secret() == ''
