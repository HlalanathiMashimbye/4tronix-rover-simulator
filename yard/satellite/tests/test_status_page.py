import json
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from playwright.sync_api import Page

# live_server comes from conftest.py: one session server shared with
# test_blockly_codegen.py, on an ephemeral port.


def mock_status(page, satellite=None, rover=None, camera=None):
    payload = {
        'satellite': satellite or {'hostname': 'testhost', 'ip': '1.2.3.4'},
        'rover': rover or {'reachable': False, 'driver': None, 'queue_size': None, 'url': 'http://x'},
        'camera': camera or {'reachable': False, 'port': 8890},
    }
    page.route('**/api/status', lambda route: route.fulfill(
        status=200, content_type='application/json', body=json.dumps(payload)
    ))


def wait_for_badge(page, name):
    page.wait_for_function(
        f"!document.getElementById('badge-{name}').className.includes('grey')"
    )


def test_satellite_always_green(page: Page, live_server):
    mock_status(page)
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'satellite')
    assert 'green' in page.locator('#badge-satellite').get_attribute('class')
    assert page.locator('#label-satellite').text_content() == 'OK'


def test_rover_green(page: Page, live_server):
    mock_status(page, rover={
        'reachable': True, 'driver': 'RealRoverDriver', 'queue_size': 0, 'url': 'http://x',
        'status': 'ok', 'processor_alive': True, 'hardware': True
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    assert 'green' in page.locator('#badge-rover').get_attribute('class')
    assert page.locator('#label-rover').text_content() == 'OK'


def test_rover_amber_fake_driver(page: Page, live_server):
    mock_status(page, rover={
        'reachable': True, 'driver': 'FakeRoverDriver', 'queue_size': 0, 'url': 'http://x',
        'status': 'ok', 'processor_alive': True, 'hardware': False
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    assert 'amber' in page.locator('#badge-rover').get_attribute('class')
    assert 'Fake' in page.locator('#label-rover').text_content()


def test_rover_mast_camera_detected(page: Page, live_server):
    mock_status(page, rover={
        'reachable': True, 'driver': 'RealRoverDriver', 'queue_size': 0, 'url': 'http://x',
        'status': 'ok', 'processor_alive': True, 'hardware': True,
        'camera': {'detected': True, 'model': 'imx219'}
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    detail = page.locator('#detail-rover').inner_text()
    assert 'imx219' in detail


def test_rover_mast_camera_not_detected(page: Page, live_server):
    mock_status(page, rover={
        'reachable': True, 'driver': 'RealRoverDriver', 'queue_size': 0, 'url': 'http://x',
        'status': 'ok', 'processor_alive': True, 'hardware': True,
        'camera': {'detected': False, 'model': None}
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    detail = page.locator('#detail-rover').inner_text()
    assert 'not detected' in detail


def test_rover_red_processor_stalled(page: Page, live_server):
    mock_status(page, rover={
        'reachable': True, 'driver': 'RealRoverDriver', 'queue_size': 3, 'url': 'http://x',
        'status': 'degraded', 'processor_alive': False
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    assert 'red' in page.locator('#badge-rover').get_attribute('class')
    assert page.locator('#label-rover').text_content() == 'Processor stalled'


def test_rover_red_unreachable(page: Page, live_server):
    mock_status(page, rover={
        'reachable': False, 'driver': None, 'queue_size': None, 'url': 'http://x'
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    assert 'red' in page.locator('#badge-rover').get_attribute('class')
    assert page.locator('#label-rover').text_content() == 'Unreachable'


def test_camera_green(page: Page, live_server):
    mock_status(page, camera={'reachable': True, 'port': 8890})
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'camera')
    assert 'green' in page.locator('#badge-camera').get_attribute('class')
    assert page.locator('#label-camera').text_content() == 'OK'


def test_camera_red(page: Page, live_server):
    mock_status(page, camera={'reachable': False, 'port': 8890})
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'camera')
    assert 'red' in page.locator('#badge-camera').get_attribute('class')
    assert page.locator('#label-camera').text_content() == 'Port closed'


def test_rover_url_shown_from_status(page: Page, live_server):
    mock_status(page, rover={
        'reachable': False, 'driver': None, 'queue_size': None, 'url': 'http://shown.local:8523'
    })
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    assert page.locator('#rover-url').text_content() == 'http://shown.local:8523'


def mock_discover(page, rovers):
    page.route('**/api/rover/discover', lambda route: route.fulfill(
        status=200, content_type='application/json', body=json.dumps({'rovers': rovers})
    ))


def capture_save(page, rover_url):
    posted = {}

    def handle(route):
        posted.update(json.loads(route.request.post_data))
        route.fulfill(
            status=200, content_type='application/json',
            body=json.dumps({'status': 'ok', 'rover_url': rover_url, 'persisted': True})
        )

    page.route('**/api/config/rover_url', handle)
    return posted


CURIOSITY = {
    'url': 'http://curiosity.local:8523',
    'addresses': ['http://curiosity.local:8523', 'http://192.168.137.121:8523'],
    'driver': 'RealRoverDriver', 'hardware': True, 'queueSize': 0, 'current': True,
}
DEV_LAPTOP_SIM = {
    'url': 'http://dev-laptop.local:8523', 'addresses': ['http://dev-laptop.local:8523'],
    'driver': 'FakeRoverDriver', 'hardware': False, 'queueSize': 0, 'current': False,
}


def open_picker(page, live_server, rovers):
    mock_discover(page, rovers)
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')
    page.click('#edit-url-btn')
    rows = page.locator('#roverList .rover-pick')
    rows.nth(len(rovers)).wait_for()
    return rows


def test_rover_picker_is_one_list_real_rovers_first_simulator_last(page: Page, live_server):
    mock_status(page, rover={'reachable': True, 'url': 'http://192.168.137.121:8523'})

    rows = open_picker(page, live_server, [DEV_LAPTOP_SIM, CURIOSITY])

    texts = rows.all_inner_texts()
    assert len(texts) == 3
    assert 'curiosity.local' in texts[0] and 'Real rover' in texts[0] and 'In use' in texts[0]
    assert '192.168.137.121' in texts[0]
    assert 'dev-laptop.local' in texts[1] and 'Simulator' in texts[1] and 'In use' not in texts[1]
    assert 'On this satellite' in texts[2]


def test_typing_an_address_waits_behind_its_toggle(page: Page, live_server):
    mock_status(page)
    open_picker(page, live_server, [])

    assert not page.locator('#url-input').is_visible()
    page.click('#url-manual summary')
    assert page.locator('#url-input').is_visible()


@pytest.mark.parametrize('row_text,expected_url', [
    ('dev-laptop.local', 'http://dev-laptop.local:8523'),
    ('On this satellite', 'http://localhost:8523'),
])
def test_picking_a_row_saves_its_address(page: Page, live_server, row_text, expected_url):
    mock_status(page, rover={'reachable': True, 'url': 'http://192.168.137.121:8523'})
    posted = capture_save(page, expected_url)

    rows = open_picker(page, live_server, [DEV_LAPTOP_SIM])
    rows.filter(has_text=row_text).click()

    page.wait_for_selector('#url-editor', state='hidden')
    assert posted['url'] == expected_url


def list_scrolls_inside(page, selector):
    return page.eval_on_selector(selector, 'el => el.scrollHeight > el.clientHeight')


def test_settings_is_two_stacks_on_a_wide_screen_and_one_column_on_a_phone(page: Page, live_server):
    mock_status(page)
    session = [
        {'name': f'mission-{i:02d}.mp4', 'modified': f'2026-09-14T10:{i:02d}:00',
         'bytes': 1_000_000, 'downloaded': False}
        for i in range(40)
    ]
    page.route('**/api/recordings', lambda route: route.fulfill(
        status=200, content_type='application/json', body=json.dumps({'recordings': session})
    ))

    page.set_viewport_size({'width': 1440, 'height': 900})
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'satellite')
    page.wait_for_selector('#recordingsList .rec-row')
    health = page.locator('#health').bounding_box()
    recordings = page.locator('#recordingsSection').bounding_box()
    assert recordings['x'] >= health['x'] + health['width']
    assert abs(recordings['y'] - health['y']) < 2
    # A session's recordings scroll inside their card rather than stretching
    # that stack far past the other one.
    assert list_scrolls_inside(page, '#recordingsList')

    page.set_viewport_size({'width': 400, 'height': 800})
    health = page.locator('#health').bounding_box()
    recordings = page.locator('#recordingsSection').bounding_box()
    assert abs(recordings['x'] - health['x']) < 2
    assert recordings['y'] > health['y'] + health['height']
    assert not list_scrolls_inside(page, '#recordingsList')


def test_rover_url_editable(page: Page, live_server):
    mock_status(page)
    posted = capture_save(page, 'http://newrover.local:8523')
    open_picker(page, live_server, [])

    assert not page.locator('#url-editor').is_hidden()
    page.click('#url-manual summary')
    page.fill('#url-input', 'http://newrover.local:8523')
    page.click('#save-url-btn')

    # Editor closes only on the success path
    page.wait_for_selector('#url-editor', state='hidden')
    assert posted['url'] == 'http://newrover.local:8523'


def test_rover_url_edit_rejected_shows_error(page: Page, live_server):
    mock_status(page)
    page.route('**/api/config/rover_url', lambda route: route.fulfill(
        status=400, content_type='application/json',
        body=json.dumps({'error': 'URL must start with http:// or https://'})
    ))
    open_picker(page, live_server, [])

    page.click('#url-manual summary')
    page.fill('#url-input', 'not-a-url')
    page.click('#save-url-btn')

    page.wait_for_function(
        "document.getElementById('url-error').textContent.includes('http://')"
    )
    assert not page.locator('#url-editor').is_hidden()
