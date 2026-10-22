"""Which Mission Control a yard belongs to, set from the Settings page.

Prod went live on marsyard.sapient.rocks with a database of its own, and
marsyard.labs.ws became staging. A yard that kept the old address would link
operators to staging and upload its recordings there, against test data, with
nothing looking wrong. Changing it used to mean editing a file on the Pi, and
the two halves did not even read the same thing: the console honoured the
config file, the uploader only the environment.
"""

import pytest

import web_server
import youtube_upload

TUNABLES = '/operator/api/config/tunables'


@pytest.fixture
def client():
    # conftest's autouse fixture already points the config file at tmp_path,
    # so what this saves lands there and nowhere real.
    web_server.app.config['TESTING'] = True
    with web_server.app.test_client() as client:
        yield client


def mission_control_link(client):
    page = client.get('/run/').get_data(as_text=True)
    return page.split('class="mc-back"', 1)[1].split('>', 1)[0]


def test_a_yard_with_nothing_set_belongs_to_prod(client, monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)

    assert 'href="https://marsyard.sapient.rocks/operator"' in mission_control_link(client)
    assert youtube_upload._endpoint() == 'https://marsyard.sapient.rocks/api/youtube-upload/recording'


def test_settings_repoints_the_link_and_the_uploads_with_no_restart(client, monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)

    # Typed the way it is written on a poster: no scheme, a trailing slash.
    resp = client.post(TUNABLES, json={'missionControlUrl': ' yard-hub.example/ '})

    assert resp.status_code == 200
    assert resp.get_json()['values']['missionControlUrl'] == 'https://yard-hub.example'
    assert 'href="https://yard-hub.example/operator"' in mission_control_link(client)
    assert youtube_upload._endpoint() == 'https://yard-hub.example/api/youtube-upload/recording'


def test_what_settings_saved_wins_over_the_environment(client, monkeypatch):
    # The environment is where a fresh satellite gets its first value, like
    # every tunable. After that the page is in charge.
    monkeypatch.setenv('MISSION_CONTROL_URL', 'https://marsyard.labs.ws')
    client.post(TUNABLES, json={'missionControlUrl': 'marsyard.sapient.rocks'})

    assert youtube_upload._endpoint() == 'https://marsyard.sapient.rocks/api/youtube-upload/recording'


@pytest.mark.parametrize('typed', [
    'not an address',
    'ftp://marsyard.sapient.rocks',
    'https://marsyard.sapient.rocks/operator',
    'javascript:alert(1)',
    'https://user@marsyard.sapient.rocks',
])
def test_anything_but_a_web_address_is_refused_and_changes_nothing(client, monkeypatch, typed):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)

    resp = client.post(TUNABLES, json={'missionControlUrl': typed})

    assert resp.status_code == 400
    assert youtube_upload._endpoint() == 'https://marsyard.sapient.rocks/api/youtube-upload/recording'
