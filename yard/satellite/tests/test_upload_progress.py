"""What the operator sees of the day's automatic uploads.

Videos go up from the satellite when it has a way out, so some go up during
the day and some only the next time it is online. The operator needs to know
which is which, and at closing whether switching off loses anything: a chip in
the top bar on every console page, and on Settings each video's state, the
day's tally and, near closing, the answer.

A real browser, with the browser's clock set: "today" and "near closing" are
the tablet's clock, which is right even on a morning the satellite booted
with no internet to set its own.
"""

import json
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402

# A Tuesday afternoon at the science centre, which closes at 16:30.
AFTERNOON = datetime(2026, 10, 21, 14, 0)
NEAR_CLOSING = datetime(2026, 10, 21, 16, 10)


def iso(when, minutes_before=0):
    return (when - timedelta(minutes=minutes_before)).astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def recording(name, at, upload=None, downloaded=False, size=8_000_000):
    return {'name': f'{name}__curiosity__20261021T120000Z.mp4', 'bytes': size, 'modified': at,
            'downloaded': downloaded, 'upload': upload}


def uploads(**summary):
    return {'configured': True, 'online': True, 'sending': None,
            'waiting': 0, 'uploaded': 0, 'manual': 0, **summary}


def satellite(page: Page, live_server, now, rows, summary, closes='16:30', path='/settings',
              width=1280, height=800, queue=12):
    """The satellite's answers, the browser's clock, and the page open."""
    status = {
        'satellite': {'hostname': 'mro', 'ip': '192.168.1.40'},
        'rover': {'reachable': True, 'status': 'ok', 'driver': 'real', 'queue_size': queue, 'url': 'http://x'},
        'camera': {'reachable': True, 'listening': True, 'ready': True, 'port': 8890, 'recording': []},
        'recording': {'active': [], 'ready': True},
        'uploads': summary,
    }
    saved = []
    page.clock.set_system_time(now)
    page.set_viewport_size({'width': width, 'height': height})
    page.route('**/api/status', lambda route: route.fulfill(json=status))
    page.route('**/api/recordings', lambda route: route.fulfill(json={
        'recordings': rows, 'disk': {'free_bytes': 5e10, 'total_bytes': 6e10, 'used_bytes': 1e10}}))

    def tunables(route):
        if route.request.method == 'POST':
            saved.append(route.request.post_data_json)
            route.fulfill(json={'status': 'ok', 'values': {**saved[-1]}, 'limits': {}, 'options': {}})
            return
        reply = route.fetch().json()
        reply['values']['yardClosesAt'] = closes
        route.fulfill(json=reply)

    page.route('**/operator/api/config/tunables', tunables)
    page.goto(f'{live_server}{path}')
    return saved


def row_badges(page: Page):
    page.wait_for_selector('#recordingsList .rec-row')
    return page.eval_on_selector_all('#recordingsList .rec-row', """rows => rows.map(row => ({
        name: row.querySelector('.rec-name').textContent,
        badges: [...row.querySelectorAll('.up-badge, .dl-badge')].map(b => b.textContent.trim()),
        link: (row.querySelector('a.up-badge') || {}).href || null,
        bar: (row.querySelector('.up-bar > span') || {style: {}}).style.width || null,
    }))""")


def test_each_video_says_where_it_has_got_to(page: Page, live_server):
    rows = [
        recording('sending', iso(AFTERNOON, 5), {'state': 'sending', 'percent': 64}),
        recording('waiting', iso(AFTERNOON, 30), {'state': 'waiting', 'attempts': 2}),
        recording('uploaded', iso(AFTERNOON, 60), {'state': 'uploaded', 'url': 'https://www.youtube.com/watch?v=abcdefghijk'}),
        recording('toobig', iso(AFTERNOON, 90), {'state': 'manual', 'reason': 'too-large'}, size=41_000_000),
    ]
    satellite(page, live_server, AFTERNOON, rows, uploads(waiting=2, uploaded=1, manual=1,
              sending={'recording': rows[0]['name'], 'sent': 64, 'total': 100}))

    by_name = {r['name'].split('__')[0]: r for r in row_badges(page)}

    assert by_name['sending']['badges'] == ['Uploading 64%'] and by_name['sending']['bar'] == '64%'
    assert by_name['waiting']['badges'] == ['Waiting to upload']
    assert by_name['uploaded']['badges'][0].startswith('On YouTube')
    assert by_name['uploaded']['link'] == 'https://www.youtube.com/watch?v=abcdefghijk'
    assert by_name['toobig']['badges'] == ['Upload by hand · too big to send']
    # "Not yet downloaded" is noise once the video uploads itself.
    assert not any('not yet' in b.lower() for r in by_name.values() for b in r['badges'])


def test_offline_a_waiting_video_says_it_is_waiting_for_internet(page: Page, live_server):
    rows = [recording('waiting', iso(AFTERNOON, 30), {'state': 'waiting'})]
    satellite(page, live_server, AFTERNOON, rows, uploads(waiting=1, online=False))

    assert row_badges(page)[0]['badges'] == ['Waiting for internet']
    assert page.inner_text('#upOnline') == 'No internet'


def test_without_automatic_uploads_the_card_is_as_it_was(page: Page, live_server):
    rows = [recording('m1', iso(AFTERNOON, 30), downloaded=True), recording('m2', iso(AFTERNOON, 60))]
    satellite(page, live_server, AFTERNOON, rows, {'configured': False})

    assert [r['badges'] for r in row_badges(page)] == [['downloaded'], ['not yet']]
    assert page.locator('#upSummary').is_hidden()
    assert page.locator('#sysUpload').is_hidden()


def test_the_tally_is_todays_videos_only(page: Page, live_server):
    rows = [
        recording('a', iso(AFTERNOON, 10), {'state': 'uploaded', 'url': 'https://youtu.be/a'}),
        recording('b', iso(AFTERNOON, 70), {'state': 'uploaded', 'url': 'https://youtu.be/b'}),
        recording('c', iso(AFTERNOON, 120), {'state': 'waiting'}),
        recording('yesterday', iso(AFTERNOON, 26 * 60), {'state': 'uploaded', 'url': 'https://youtu.be/y'}),
    ]
    satellite(page, live_server, AFTERNOON, rows, uploads(waiting=1, uploaded=2))
    row_badges(page)

    assert page.inner_text('#upTally') == 'Today: 2 on YouTube, 1 waiting'


def test_a_day_with_no_videos_yet_says_so(page: Page, live_server):
    satellite(page, live_server, AFTERNOON, [], uploads())
    page.wait_for_selector('#upSummary:not([hidden])')

    assert page.inner_text('#upTally') == 'No videos today yet'


def test_early_in_the_day_it_says_nothing_about_closing(page: Page, live_server):
    rows = [recording('waiting', iso(AFTERNOON, 30), {'state': 'waiting'})]
    satellite(page, live_server, AFTERNOON, rows, uploads(waiting=1, online=False))
    row_badges(page)

    assert page.locator('#upClosing').is_hidden()
    assert 'Yard closes' in page.inner_text('#upSummary') and '2 h 30 min' in page.inner_text('#upCountdown')


@pytest.mark.parametrize('rows,summary,tone,words', [
    ([recording('w', iso(NEAR_CLOSING, 20), {'state': 'waiting'}),
      recording('w2', iso(NEAR_CLOSING, 40), {'state': 'waiting'})],
     uploads(waiting=2, online=False), 'warn',
     "2 videos haven't gone up. Safe to switch off: they go up by themselves next time the satellite is online."),
    ([recording('u', iso(NEAR_CLOSING, 20), {'state': 'uploaded', 'url': 'https://youtu.be/u'})],
     uploads(uploaded=1), 'ok', 'Everything from today is on YouTube. Safe to switch off.'),
    ([recording('s', iso(NEAR_CLOSING, 5), {'state': 'sending', 'percent': 30})],
     uploads(waiting=1, sending={'recording': 's', 'sent': 30, 'total': 100}), 'info',
     'A video is uploading now. Leave the satellite on until it finishes'),
])
def test_near_closing_it_says_whether_switching_off_loses_anything(page: Page, live_server, rows, summary, tone, words):
    satellite(page, live_server, NEAR_CLOSING, rows, summary)
    page.wait_for_selector('#upClosing:not([hidden])')

    assert page.get_attribute('#upClosing', 'data-tone') == tone
    assert words in page.inner_text('#upClosing')
    assert '20 min' in page.inner_text('#upCountdown')


def test_a_video_that_needs_uploading_by_hand_is_mentioned_at_closing(page: Page, live_server):
    rows = [recording('u', iso(NEAR_CLOSING, 20), {'state': 'uploaded', 'url': 'https://youtu.be/u'}),
            recording('big', iso(NEAR_CLOSING, 50), {'state': 'manual', 'reason': 'too-large'})]
    satellite(page, live_server, NEAR_CLOSING, rows, uploads(uploaded=1, manual=1))
    page.wait_for_selector('#upClosing:not([hidden])')

    assert '1 needs uploading by hand.' in page.inner_text('#upClosing')


def test_another_venue_sets_its_own_closing_time_and_it_saves_itself(page: Page, live_server):
    saved = satellite(page, live_server, AFTERNOON, [], uploads())
    page.wait_for_selector('#upSummary:not([hidden])')

    page.fill('#tunClosesAt', '17:00')
    page.dispatch_event('#tunClosesAt', 'change')
    page.wait_for_function('document.getElementById("closesMsg").textContent.startsWith("Saved")')

    assert saved[-1] == {'yardClosesAt': '17:00'}
    assert '3 h' in page.inner_text('#upCountdown')


def test_a_selection_survives_the_list_redrawing_while_videos_upload(page: Page, live_server):
    """The list redraws itself as videos settle. A selection made for
    deleting must not vanish under the operator's finger."""
    rows = [recording('a', iso(AFTERNOON, 10), {'state': 'waiting'}),
            recording('b', iso(AFTERNOON, 20), {'state': 'waiting'})]
    satellite(page, live_server, AFTERNOON, rows, uploads(waiting=2))
    row_badges(page)
    page.locator('.rec-check').first.check()

    page.evaluate("() => paintRecordings()")

    assert page.locator('.rec-check').first.is_checked()
    assert page.locator('#recDeleteBar').is_visible()


@pytest.mark.parametrize('summary,words,tone', [
    (uploads(waiting=3), '3 videos waiting to upload', 'warn'),
    (uploads(waiting=1, online=False), '1 video waiting to upload · no internet', 'warn'),
    (uploads(waiting=2, sending={'recording': 'x', 'sent': 40, 'total': 100}), 'Uploading 40% · 1 more', 'info'),
    (uploads(uploaded=4), 'All on YouTube', 'ok'),
])
def test_the_top_bar_says_how_the_days_uploads_are_going(page: Page, live_server, summary, words, tone):
    """On every console page: the operator spends the day on the run station."""
    satellite(page, live_server, AFTERNOON, [], summary, path='/run/', width=1366, height=768)
    page.wait_for_selector('#sysUpload:not([hidden])')

    assert page.inner_text('#sysUpload .sys-txt') == words
    assert page.get_attribute('#sysUpload', 'data-tone') == tone
    assert page.get_attribute('#sysUpload', 'href') == '/settings#recordingsSection'


def test_with_nothing_to_say_the_chip_is_not_there(page: Page, live_server):
    satellite(page, live_server, AFTERNOON, [], uploads(), path='/run/')
    page.wait_for_function('window.YardStatus && YardStatus.latest()')

    assert page.locator('#sysUpload').is_hidden()


BAR = """() => {
    const box = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return {left: b.left, right: b.right, width: b.width}; };
    const txt = document.querySelector('#sysRover .sys-txt');
    return {viewport: innerWidth, page: document.documentElement.scrollWidth,
            chip: box('#sysUpload'), rover: box('#sysRover'), roverCut: txt.scrollWidth > txt.clientWidth};
}"""


@pytest.mark.parametrize('width', [768, 820, 1024, 1280, 1366])
def test_on_a_tablet_or_a_laptop_the_chip_fits_beside_the_rover_and_both_read_whole(page: Page, live_server, width):
    """The bar had no room to spare at 768 or 1024; the chip comes down to its
    icon and number, and the brand's name gives way while it is up."""
    summary = uploads(waiting=2, sending={'recording': 'x', 'sent': 64, 'total': 100})
    satellite(page, live_server, AFTERNOON, [], summary, path='/run/', width=width, height=1024)
    page.wait_for_selector('#sysUpload:not([hidden])')
    page.evaluate('document.fonts.ready.then(() => true)')
    bar = page.evaluate(BAR)

    assert bar['page'] <= bar['viewport'], bar
    assert 0 <= bar['chip']['left'] and bar['rover']['right'] <= bar['viewport'], bar
    assert not bar['roverCut'], bar


@pytest.mark.parametrize('width', [360, 375, 390, 414])
def test_on_a_phone_the_chip_and_the_rover_are_both_on_screen(page: Page, live_server, width):
    """On a phone there is no room for both whole: the rover's chip keeps its
    dot and gives up the end of its words, and the page still does not scroll."""
    summary = uploads(waiting=2)
    satellite(page, live_server, AFTERNOON, [], summary, path='/run/', width=width, height=800)
    page.wait_for_selector('#sysUpload:not([hidden])')
    bar = page.evaluate(BAR)

    assert bar['page'] <= bar['viewport'], bar
    assert bar['chip']['width'] > 0 and bar['rover']['right'] <= bar['viewport'], bar
