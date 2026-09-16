import threading
import time
import json
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from web_server import app as flask_app
from playwright.sync_api import Page

PORT = 15050


@pytest.fixture(scope='session', autouse=True)
def live_server():
    t = threading.Thread(
        target=lambda: flask_app.run(port=PORT, use_reloader=False, threaded=True),
        daemon=True,
    )
    t.start()
    time.sleep(1)
    return f'http://localhost:{PORT}'


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


def open_settings(page, live_server, rovers):
    mock_discover(page, rovers)
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'rover')


def test_find_rover_picks_real_hardware_over_a_simulator(page: Page, live_server):
    """One press, one decision. Auto-find saves the best rover that actually
    answered - real hardware first - instead of opening a list to read."""
    mock_status(page, rover={'reachable': True, 'url': 'http://192.168.137.121:8523'})
    posted = capture_save(page, CURIOSITY['url'])

    open_settings(page, live_server, [DEV_LAPTOP_SIM, CURIOSITY])
    page.click('#findRoverBtn')

    page.wait_for_function(
        "document.getElementById('findMsg').textContent.includes('curiosity.local')"
    )
    assert posted['url'] == CURIOSITY['url']


def test_find_rover_says_so_when_nothing_answers(page: Page, live_server):
    mock_status(page)
    open_settings(page, live_server, [])

    page.click('#findRoverBtn')

    page.wait_for_function(
        "document.getElementById('findMsg').textContent.includes('No rover answered')"
    )


def test_the_simulator_is_a_toggle(page: Page, live_server):
    """Flipping it on points the yard at the simulator on this satellite;
    the toggle reflects the saved address, not a hopeful local state."""
    mock_status(page, rover={'reachable': True, 'url': 'http://192.168.137.121:8523'})
    posted = capture_save(page, 'http://localhost:8523')

    open_settings(page, live_server, [])
    assert not page.locator('#simToggle').is_checked()
    page.click('#simToggle')

    # The saved address is the source of truth to wait on via findMsg, not
    # #rover-url: the mocked /api/status keeps repainting the stale address,
    # which is exactly what a real save would change server-side.
    page.wait_for_function(
        "document.getElementById('findMsg').textContent.includes('Simulator')"
    )
    assert posted['url'] == 'http://localhost:8523'
    assert posted['force'] is True


def test_the_toggle_starts_on_when_the_yard_already_runs_the_simulator(page: Page, live_server):
    mock_status(page, rover={'reachable': True, 'url': 'http://localhost:8523'})
    open_settings(page, live_server, [])

    page.wait_for_function("document.getElementById('simToggle').checked")


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
    rover = page.locator('#card-rover').bounding_box()
    storage = page.locator('#cleanupSection').bounding_box()
    recordings = page.locator('#recordingsSection').bounding_box()
    # Rover and camera down the left; storage and the recordings it governs
    # share the right stack.
    assert storage['x'] >= rover['x'] + rover['width']
    assert abs(storage['y'] - rover['y']) < 2
    assert recordings['y'] > storage['y'] + storage['height']
    # A session's recordings scroll inside their card rather than stretching
    # that stack far past the other one.
    assert list_scrolls_inside(page, '#recordingsList')

    page.set_viewport_size({'width': 400, 'height': 800})
    rover = page.locator('#card-rover').bounding_box()
    recordings = page.locator('#recordingsSection').bounding_box()
    assert abs(recordings['x'] - rover['x']) < 2
    assert recordings['y'] > rover['y'] + rover['height']
    assert not list_scrolls_inside(page, '#recordingsList')


def test_typing_an_address_still_works_as_the_fallback(page: Page, live_server):
    mock_status(page)
    posted = capture_save(page, 'http://newrover.local:8523')
    open_settings(page, live_server, [])

    page.fill('#url-input', 'http://newrover.local:8523')
    page.click('#save-url-btn')

    # Wait on the POST itself: the mocked /api/status keeps repainting the
    # old address over #rover-url, which a real save would have changed.
    for _ in range(50):
        if posted:
            break
        page.wait_for_timeout(100)
    assert posted['url'] == 'http://newrover.local:8523'


def test_rover_url_edit_rejected_shows_error(page: Page, live_server):
    mock_status(page)
    page.route('**/api/config/rover_url', lambda route: route.fulfill(
        status=400, content_type='application/json',
        body=json.dumps({'error': 'URL must start with http:// or https://'})
    ))
    open_settings(page, live_server, [])

    page.fill('#url-input', 'not-a-url')
    page.click('#save-url-btn')

    page.wait_for_function(
        "document.getElementById('url-error').textContent.includes('http://')"
    )


# ---- Saving a setting -------------------------------------------------
# There is no Save button on this page. Every control commits itself when it
# is done being changed, and says so in two places, because the card's line
# cannot name which of three numbers took and a flash on the field cannot say
# "adjusted to 16" or why a save failed.

TUNABLE_VALUES = {
    'cameraReadyTimeout': 2.0,
    'cameraResolution': '640x480',
    'cleanupGracePeriod': 72.0,
    'cleanupMaxAge': 21.0,
    'cleanupMinFreeGB': 2.0,
}
RESOLUTION_OPTIONS = {
    'cameraResolution': {
        'values': ['640x480', '1280x960', '1920x1440'],
        'labels': ['Standard', 'Sharp', 'Sharpest'],
    }
}


def mock_tunables(page, clamp_to=None, fail=False):
    """Serve the tunables endpoint, recording what gets POSTed to it.

    One URL serves both the load (GET) and every save (POST), so the handler
    has to split on the method. `clamp_to` stands in for the server refusing
    the number it was sent and answering with the one actually in force.
    """
    posted = []

    def handle(route):
        request = route.request
        if request.method != 'POST':
            route.fulfill(status=200, content_type='application/json', body=json.dumps(
                {'values': TUNABLE_VALUES, 'options': RESOLUTION_OPTIONS, 'limits': {}}))
            return

        body = json.loads(request.post_data)
        posted.append(body)
        if fail:
            route.fulfill(status=500, content_type='application/json',
                          body=json.dumps({'error': 'Could not write the config file'}))
            return
        in_force = dict(TUNABLE_VALUES)
        in_force.update(body)
        if clamp_to is not None:
            in_force.update(clamp_to)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(
            {'status': 'ok', 'values': in_force, 'options': RESOLUTION_OPTIONS, 'limits': {}}))

    page.route('**/api/config/tunables', handle)
    return posted


def open_tuned_settings(page, live_server, **kwargs):
    mock_status(page)
    posted = mock_tunables(page, **kwargs)
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'satellite')
    # The load has to have landed, or the first save races the repaint.
    page.wait_for_function(
        "document.getElementById('tunGracePeriod').value === '72'")
    return posted


def test_a_number_saves_itself_with_no_button_pressed(page: Page, live_server):
    posted = open_tuned_settings(page, live_server)

    page.fill('#tunGracePeriod', '48')
    page.locator('#tunGracePeriod').blur()

    page.wait_for_function(
        "document.getElementById('cleanupMsg').textContent === 'Saved'")
    assert posted == [{'cleanupGracePeriod': 48}]


def test_the_field_that_saved_says_so_itself(page: Page, live_server):
    """The card's line cannot name which of three numbers took."""
    open_tuned_settings(page, live_server)

    page.fill('#tunMaxAge', '30')
    page.locator('#tunMaxAge').blur()

    page.wait_for_function(
        "document.getElementById('tunMaxAge').closest('.sync-input-row')"
        ".classList.contains('just-saved')")


def test_a_clamped_value_repaints_and_says_it_was_adjusted(page: Page, live_server):
    """The server clamps, so what was typed is not always what is in force.

    A number left on screen that is true nowhere else is worse than no
    number, and worse still silently: this is the one save where what the
    operator asked for and what they got are different.
    """
    posted = open_tuned_settings(page, live_server, clamp_to={'cleanupMinFreeGB': 16})

    page.fill('#tunMinFreeGB', '99')
    page.locator('#tunMinFreeGB').blur()

    page.wait_for_function(
        "document.getElementById('cleanupMsg').textContent.includes('adjusted to 16')")
    assert posted == [{'cleanupMinFreeGB': 99}]
    assert page.locator('#tunMinFreeGB').input_value() == '16'


def test_a_failed_save_marks_the_field_and_keeps_saying_so(page: Page, live_server):
    """The number on screen is now true nowhere else.

    Neither the message nor the mark may be on a timer, because one that
    cleared itself would leave the operator believing it went through.
    """
    open_tuned_settings(page, live_server, fail=True)

    page.fill('#tunGracePeriod', '48')
    page.locator('#tunGracePeriod').blur()

    page.wait_for_function(
        "document.getElementById('tunGracePeriod').closest('.sync-input-row')"
        ".classList.contains('save-failed')")
    message = page.locator('#cleanupMsg')
    assert 'Could not write' in message.text_content()
    # Still there well after the success message's own timeout would have run.
    page.wait_for_timeout(4500)
    assert 'Could not write' in message.text_content()


def test_the_slider_saves_on_release_not_on_every_step(page: Page, live_server):
    """Dragging fires 'input' the whole way across; only the release counts."""
    posted = open_tuned_settings(page, live_server)

    page.eval_on_selector('#tunCameraReady', """el => {
        el.value = 3.5;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }""")
    page.wait_for_timeout(700)
    assert posted == [], 'a drag in progress is not a decision'

    page.eval_on_selector('#tunCameraReady',
                          "el => el.dispatchEvent(new Event('change', { bubbles: true }))")
    page.wait_for_function(
        "document.getElementById('tunMsg').textContent === 'Saved'")
    assert posted == [{'cameraReadyTimeout': 3.5}]


def test_a_value_above_the_slider_says_the_real_number(page: Page, live_server):
    """A range input clamps what it DISPLAYS, so 7.5 shows as 5.0 and lies.

    Values above the slider's ceiling can be set through the API or predate
    the slider, and the yard this was written on had one.
    """
    mock_status(page)
    page.route('**/api/config/tunables', lambda route: route.fulfill(
        status=200, content_type='application/json',
        body=json.dumps({'values': dict(TUNABLE_VALUES, cameraReadyTimeout=7.5),
                         'options': RESOLUTION_OPTIONS, 'limits': {}})))
    page.goto(f'{live_server}/status')
    wait_for_badge(page, 'satellite')

    page.wait_for_function(
        "document.getElementById('tunMsg').textContent.includes('In force: 7.5s')")
