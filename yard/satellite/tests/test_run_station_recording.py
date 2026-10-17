"""The run station says when it is recording, and when the run is done.

Both used to be small and grey. Recording was a 9px dot in a grey button and
a grey tag, so a recording looked like no recording until the video turned up
afterwards. The end of a run was a line of small print under the buttons,
gone in five seconds, and the download a 32px icon in the rail.

A real browser, because what is under test is what the operator sees. The
satellite's answers are stood in for, so the page goes through a whole run:
Mission Control's handoff, the recording starting, the rover finishing.
"""

import re
from urllib.parse import urlencode

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402

FILE = 'm1__curiosity__20261017T120000Z.mp4'
SIZE = 4_404_019  # 4.2 MB
NEWER = 'by-hand__curiosity__20261017T120200Z.mp4'


class FakeSatellite:
    """The satellite's half of one run, answering the page's requests.

    `filming` is what the satellite is recording. A start held back is the
    camera taking its time to say yes; a status held back is a request that
    was already on its way when something changed.
    """

    def __init__(self, page: Page, hold_start=False):
        self.page = page
        self.filming = []
        self.hold_start = hold_start
        self.hold_status = False
        self.held_starts = []
        self.held_statuses = []
        page.route('**/api/status', self._status)
        page.route('**/api/recording/start', self._start)
        page.route('**/api/recording/stop', self._stop)
        page.route('**/api/queue/add', lambda route: route.fulfill(json={'status': 'ok'}))
        page.route('**/api/queue/clear', lambda route: route.fulfill(json={'status': 'ok'}))
        # Newest first, as the satellite lists them, and something newer than
        # this run on the card: a recording somebody started by hand.
        page.route('**/api/recordings', lambda route: route.fulfill(json={'recordings': [
            {'name': NEWER, 'bytes': 2_000_000, 'modified': '2026-10-17T12:02:10Z', 'downloaded': False},
            {'name': FILE, 'bytes': SIZE, 'modified': '2026-10-17T12:01:30Z', 'downloaded': False},
            {'name': 'm0__curiosity__20261016T090000Z.mp4', 'bytes': 1_000_000,
             'modified': '2026-10-16T09:01:00Z', 'downloaded': True},
        ]}))
        page.route(f'**/api/recordings/{FILE}', lambda route: route.fulfill(
            body=b'not really a video', content_type='video/mp4',
            headers={'Content-Disposition': f'attachment; filename={FILE}'}))

    def payload(self):
        return {
            'satellite': {'hostname': 'mro', 'ip': '10.0.0.2'},
            'rover': {'reachable': True, 'status': 'ok', 'driver': 'real', 'queue_size': 0,
                      'url': 'http://curiosity.local:8523'},
            'camera': {'listening': True, 'ready': True, 'recording': list(self.filming)},
            'recording': {'active': list(self.filming), 'ready': True},
        }

    def _status(self, route):
        if self.hold_status:
            # Answered later with what was true when it was asked.
            self.held_statuses.append((route, self.payload()))
            return
        route.fulfill(json=self.payload())

    def _start(self, route):
        if self.hold_start:
            self.held_starts.append(route)
            return
        self._started(route)

    def _started(self, route):
        self.filming = ['m1']
        route.fulfill(json={'status': 'recording', 'name': 'm1', 'file': FILE})

    def _stop(self, route):
        self.filming = []
        route.fulfill(json={'status': 'stopped', 'kept': True})

    def release_start(self):
        self._started(self.held_starts.pop())

    def wait_for(self, queue):
        for _ in range(100):
            if queue:
                return
            self.page.wait_for_timeout(50)
        raise AssertionError('the page never asked')

    def rover_finishes(self):
        """What the watcher does: the recording stops, and the next status says so."""
        self.filming = []
        self.page.evaluate('() => { YardStatus.refreshNow(); }')


def handoff(live_server):
    """Mission Control's Send to Rover: the page runs the mission by itself
    once the camera and the rover are ready."""
    from satellite_identity import yard_id
    params = {'handoff': 'automatic', 'yardId': yard_id(), 'missionId': 'm1',
              'missionName': 'Rock Lover', 'code': 'rover.forward(60)\ntime.sleep(1)\nrover.stop()'}
    return f'{live_server}/run/?{urlencode(params)}'


def open_run(page: Page, live_server, width=1366, height=768):
    page.set_viewport_size({'width': width, 'height': height})
    page.goto(handoff(live_server))


def wait_recording(page: Page):
    page.wait_for_function(
        "document.querySelector('.live-panel').dataset.rec === 'on'"
        " && !document.getElementById('recBadge').hidden")


# What the operator can see of the recording, read off the page.
RECORDING = """() => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    const badge = document.getElementById('recBadge');
    const view = document.querySelector('.live-view');
    return {
        state: document.querySelector('.live-panel').dataset.rec,
        shown: !badge.hidden && badge.getBoundingClientRect().width > 0,
        label: document.getElementById('recLabel').textContent,
        clock: document.getElementById('recClock').textContent,
        badge: box(badge), view: box(view),
        fill: getComputedStyle(badge).backgroundColor,
        edge: getComputedStyle(view, '::after').boxShadow,
    };
}"""

NOTICE = """() => {
    const dialog = document.getElementById('doneNotice');
    const b = dialog.getBoundingClientRect();
    const button = document.getElementById('doneDownload').getBoundingClientRect();
    return {
        open: dialog.open,
        heading: document.getElementById('doneTitle').textContent.trim(),
        headingPx: parseFloat(getComputedStyle(document.getElementById('doneTitle')).fontSize),
        sentence: document.getElementById('doneSub').textContent.replace(/\\s+/g, ' ').trim(),
        file: document.getElementById('doneFile').textContent,
        width: b.width, buttonHeight: button.height,
        focused: document.activeElement && document.activeElement.id,
        title: document.title,
    };
}"""


def rgb(colour):
    return tuple(int(n) for n in re.findall(r'\d+', colour)[:3])


def is_red(colour):
    r, g, b = rgb(colour)
    return r > 180 and g < 90 and b < 90


def test_while_it_records_the_picture_says_rec_in_red_with_a_clock_that_runs(page: Page, live_server):
    FakeSatellite(page)
    open_run(page, live_server)
    wait_recording(page)
    rec = page.evaluate(RECORDING)

    assert rec['shown'] and rec['label'] == 'REC', rec
    # On the picture, where the operator is looking, not in the panel's bar.
    assert rec['view']['left'] <= rec['badge']['left'] and rec['badge']['right'] <= rec['view']['right'], rec
    assert rec['view']['top'] <= rec['badge']['top'] and rec['badge']['bottom'] <= rec['view']['bottom'], rec
    # Red, not the grey that read as nothing happening.
    assert is_red(rec['fill']), rec
    assert 'inset' in rec['edge'] and is_red(rec['edge']), rec

    assert re.fullmatch(r'\d+:\d\d', rec['clock']), rec
    page.wait_for_function(
        f"document.getElementById('recClock').textContent !== {rec['clock']!r}", timeout=3000)


def test_until_the_camera_says_yes_it_says_starting_not_rec(page: Page, live_server):
    """Send asks the satellite to record, and the satellite checks frames are
    arriving first. Until it answers, the picture says the recording is on its
    way, and does not claim it has begun."""
    fake = FakeSatellite(page, hold_start=True)
    open_run(page, live_server)
    fake.wait_for(fake.held_starts)
    page.wait_for_function("!document.getElementById('recBadge').hidden")
    rec = page.evaluate(RECORDING)

    assert rec['state'] == 'starting' and rec['label'] == 'Starting recording', rec
    assert rec['clock'] == '', rec
    assert not is_red(rec['fill']), rec

    fake.release_start()
    wait_recording(page)


def test_a_finished_run_opens_a_big_notice_whose_button_downloads_its_video(page: Page, live_server):
    fake = FakeSatellite(page)
    open_run(page, live_server)
    wait_recording(page)

    fake.rover_finishes()
    page.wait_for_function("document.getElementById('doneNotice').open")
    notice = page.evaluate(NOTICE)

    assert notice['heading'] == 'Mission complete', notice
    assert notice['sentence'].startswith('Rock Lover has finished'), notice
    assert FILE in notice['file'] and '4.2 MB' in notice['file'], notice
    # Big enough to be seen from the yard, not a toast in a corner.
    assert notice['width'] >= 480 and notice['headingPx'] >= 28 and notice['buttonHeight'] >= 56, notice
    assert notice['focused'] == 'doneDownload', notice
    assert notice['title'].startswith('Mission complete'), notice
    # The recording is over, so the picture stops saying REC.
    assert not page.evaluate(RECORDING)['shown']

    with page.expect_download() as download:
        page.click('#doneDownload')
    assert download.value.suggested_filename == FILE
    # The file this run wrote, not whichever was newest on the card.
    assert not page.evaluate(NOTICE)['open']
    assert page.eval_on_selector('#videoPick', 'el => el.value') == FILE


def test_a_status_asked_for_before_the_recording_started_does_not_finish_the_run(page: Page, live_server):
    """A status request already on its way when Send was pressed comes back
    without the new recording in it. Read as the recording having stopped,
    it announced a run complete a second after the rover set off."""
    fake = FakeSatellite(page, hold_start=True)
    open_run(page, live_server)
    fake.wait_for(fake.held_starts)

    fake.hold_status = True
    page.evaluate('() => { YardStatus.refreshNow(); }')
    fake.wait_for(fake.held_statuses)
    fake.hold_status = False

    fake.release_start()
    wait_recording(page)
    route, as_it_was = fake.held_statuses.pop()
    assert as_it_was['recording']['active'] == []
    route.fulfill(json=as_it_was)
    page.wait_for_timeout(400)

    assert not page.evaluate(NOTICE)['open']
    assert page.evaluate(RECORDING)['state'] == 'on'


def test_pressing_stop_ends_the_recording_and_does_not_call_the_run_complete(page: Page, live_server):
    fake = FakeSatellite(page)
    open_run(page, live_server)
    wait_recording(page)

    page.click('#stopBtn')
    page.wait_for_function("document.querySelector('.live-panel').dataset.rec === 'off'")
    page.evaluate('() => YardStatus.refreshNow()')
    page.wait_for_timeout(300)

    assert fake.filming == []
    assert not page.evaluate(RECORDING)['shown']
    assert not page.evaluate(NOTICE)['open']


def test_escape_closes_the_notice_and_gives_the_tab_its_name_back(page: Page, live_server):
    fake = FakeSatellite(page)
    open_run(page, live_server)
    title = page.title()
    wait_recording(page)
    fake.rover_finishes()
    page.wait_for_function("document.getElementById('doneNotice').open")

    page.keyboard.press('Escape')

    assert not page.evaluate(NOTICE)['open']
    # The dialog's close event comes a task after Escape, not in the same one.
    page.wait_for_function('(title) => document.title === title', arg=title, timeout=2000)


def test_with_motion_turned_off_the_tick_is_still_drawn(page: Page, live_server):
    """The tick draws itself by animating its stroke in. With animations
    switched off for reduced motion it stayed at the start: an empty circle."""
    page.emulate_media(reduced_motion='reduce')
    fake = FakeSatellite(page)
    open_run(page, live_server)
    wait_recording(page)
    fake.rover_finishes()
    page.wait_for_function("document.getElementById('doneNotice').open")

    offset = page.eval_on_selector('.announce-mark svg', 'el => getComputedStyle(el).strokeDashoffset')
    assert float(offset.replace('px', '')) == 0, offset


@pytest.mark.parametrize('width,height', [(390, 844), (768, 1024)])
def test_on_a_phone_and_a_tablet_the_notice_fits_the_screen(page: Page, live_server, width, height):
    fake = FakeSatellite(page)
    open_run(page, live_server, width, height)
    wait_recording(page)
    fake.rover_finishes()
    page.wait_for_function("document.getElementById('doneNotice').open")

    box = page.eval_on_selector('#doneNotice', 'el => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }')
    left, top, right, bottom = box
    assert 0 <= left and right <= width and 0 <= top and bottom <= height, box
    assert page.evaluate('document.documentElement.scrollWidth') <= width
