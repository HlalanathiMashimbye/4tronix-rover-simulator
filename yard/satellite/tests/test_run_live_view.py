"""The run station's live view: the camera's picture, filling its panel.

The live column was a fixed share of the window, and at every laptop size
that is wider than a 4:3 picture as tall as the column leaves room for. The
picture sat in the middle of its panel with a dark bar down each side, 118px
of bar at 1366 x 768. The column is now as wide as the picture, measured by
the page (fitLiveColumn in run.html), and the rail has the width it gave up.

A real browser, because the thing under test is a layout.
"""

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402

LAPTOPS = [(1366, 768), (1920, 1080), (1280, 720), (1512, 860), (1024, 768)]


def open_station(page: Page, live_server, width, height):
    page.set_viewport_size({'width': width, 'height': height})
    page.goto(f'{live_server}/run/')
    # The column is fitted by script once the page is laid out.
    page.wait_for_function(
        "document.querySelector('.desk-grid').style.getPropertyValue('--live-w') !== ''",
        timeout=5000)
    settle(page)


def settle(page: Page):
    """Two frames: one for the fit that a resize queued, one for its layout."""
    page.evaluate("() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))")


def station(page: Page):
    return page.evaluate("""() => {
        const box = (selector) => {
            const b = document.querySelector(selector).getBoundingClientRect();
            return { left: b.left, top: b.top, width: b.width, height: b.height, bottom: b.bottom, right: b.right };
        };
        return {
            grid: box('.desk-grid'), panel: box('.live-panel'), view: box('.live-view'),
            foot: box('.live-foot'), stop: box('#stopBtn'), rail: box('.side'),
            screen: { width: innerWidth, height: innerHeight },
            scrollsBy: document.documentElement.scrollHeight - innerHeight,
            fit: getComputedStyle(document.getElementById('cameraCanvas')).objectFit,
        };
    }""")


def is_the_pictures_shape(view):
    # 4:3 to within a couple of pixels of rounding, so fitting the picture in
    # it leaves no bar at either side and none above or below.
    return abs(view['width'] - view['height'] * 4 / 3) <= 2


@pytest.mark.parametrize('width,height', LAPTOPS)
def test_the_picture_fills_the_live_view_with_no_bar_beside_it(page: Page, live_server, width, height):
    open_station(page, live_server, width, height)

    now = station(page)

    assert now['fit'] == 'contain'
    assert is_the_pictures_shape(now['view']), \
        f"the view is {now['view']['width']:.0f} x {now['view']['height']:.0f}"


@pytest.mark.parametrize('width,height', LAPTOPS)
def test_stop_is_still_on_the_screen_and_the_page_does_not_scroll(page: Page, live_server, width, height):
    # The whole point of the station is that Stop is always where the thumb
    # left it.
    open_station(page, live_server, width, height)

    now = station(page)

    assert now['stop']['bottom'] <= now['screen']['height']
    assert now['scrollsBy'] <= 0


@pytest.mark.parametrize('width,height', LAPTOPS)
def test_the_rail_has_the_width_the_picture_gave_up(page: Page, live_server, width, height):
    open_station(page, live_server, width, height)

    now = station(page)

    assert now['rail']['width'] >= 340
    # Column, gap, rail: nothing of the row is left over.
    assert abs(now['rail']['right'] - now['grid']['right']) <= 1
    assert abs(now['panel']['left'] - now['grid']['left']) <= 1


def test_a_warning_coming_and_going_refits_the_column(page: Page, live_server):
    # The warning is 40px of the panel. Without a refit the picture is that
    # much short of its box, or its box that much short of the picture.
    open_station(page, live_server, 1366, 768)
    show = "(on) => document.getElementById('runWarning').classList.toggle('show', on)"

    page.evaluate(show, True)
    settle(page)
    warned = station(page)
    page.evaluate(show, False)
    settle(page)
    clear = station(page)

    assert is_the_pictures_shape(warned['view'])
    assert is_the_pictures_shape(clear['view'])
    assert clear['view']['width'] > warned['view']['width'] + 20
    assert clear['stop']['bottom'] <= clear['screen']['height']


def test_on_an_upright_tablet_the_panel_ends_under_its_buttons(page: Page, live_server):
    # There the column's width is the limit, not its height. The view used to
    # stretch to the foot of the screen with the picture in the middle of a
    # dark box twice its height.
    open_station(page, live_server, 768, 1024)

    now = station(page)

    assert is_the_pictures_shape(now['view'])
    assert now['panel']['bottom'] < now['grid']['bottom'] - 100
    assert abs(now['foot']['bottom'] - now['panel']['bottom']) <= 2


def test_a_tall_window_does_not_hand_the_rail_to_the_picture(page: Page, live_server):
    # As tall as it is wide: by height alone the picture would take the row.
    open_station(page, live_server, 1366, 1366)

    now = station(page)

    assert now['panel']['width'] <= now['grid']['width'] * 0.574 + 1
    assert now['rail']['width'] >= 340


def test_a_very_short_window_keeps_the_column_wide_enough_for_its_buttons(page: Page, live_server):
    open_station(page, live_server, 1366, 480)

    now = station(page)

    assert now['panel']['width'] >= 22 * 16 - 1


# --- Stacked on a phone --------------------------------------------------------
# The rail took the height its cards wanted before the live panel got any, and
# the panel was left 220px for a header and controls that are 257 on their
# own. A phone showed no picture at all, and the foot of the panel was cut off
# through the middle of Send and Stop (found 14 October 2026).

PHONES = [(390, 844), (412, 915), (360, 800)]
SHORT_PHONES = [(375, 667), (360, 640)]


def phone(page: Page):
    return page.evaluate("""() => {
        const box = (selector) => {
            const b = document.querySelector(selector).getBoundingClientRect();
            return { left: b.left, top: b.top, width: b.width, height: b.height, bottom: b.bottom, right: b.right };
        };
        const head = document.querySelector('.live-panel .panel-head');
        return {
            panel: box('.live-panel'), view: box('.live-view'), stop: box('#stopBtn'), send: box('#runBtn'),
            rail: box('.side'), headRunsOver: head.scrollWidth - head.clientWidth,
            screen: { width: innerWidth, height: innerHeight },
            scrollsBy: document.documentElement.scrollHeight - innerHeight,
        };
    }""")


@pytest.mark.parametrize('width,height', PHONES + SHORT_PHONES)
def test_a_phone_shows_the_picture_with_its_warning_up(page: Page, live_server, width, height):
    open_station(page, live_server, width, height)
    page.evaluate("document.getElementById('runWarning').classList.add('show')")
    settle(page)

    now = phone(page)

    assert now['view']['height'] >= 120, f"the picture has {now['view']['height']:.0f}px"


@pytest.mark.parametrize('width,height', PHONES)
def test_on_a_phone_the_picture_is_the_width_of_the_panel(page: Page, live_server, width, height):
    open_station(page, live_server, width, height)
    page.evaluate("document.getElementById('runWarning').classList.add('show')")
    settle(page)

    now = phone(page)

    assert is_the_pictures_shape(now['view'])
    assert now['view']['width'] >= now['panel']['width'] - 4


@pytest.mark.parametrize('width,height', PHONES + SHORT_PHONES)
def test_on_a_phone_send_and_stop_are_whole_and_on_the_screen(page: Page, live_server, width, height):
    open_station(page, live_server, width, height)
    page.evaluate("document.getElementById('runWarning').classList.add('show')")
    settle(page)

    now = phone(page)

    for button in (now['stop'], now['send']):
        # Inside the panel, which clips what runs past it, and on the screen.
        assert button['bottom'] <= now['panel']['bottom']
        assert button['bottom'] <= now['screen']['height']
        # A thumb's worth.
        assert button['height'] >= 44
    assert now['scrollsBy'] <= 0


@pytest.mark.parametrize('width,height', PHONES + SHORT_PHONES)
def test_on_a_phone_the_rail_keeps_room_to_be_scrolled_in(page: Page, live_server, width, height):
    open_station(page, live_server, width, height)

    now = phone(page)

    assert now['rail']['height'] >= 5 * 16 - 1
    assert now['rail']['bottom'] <= now['screen']['height']


@pytest.mark.parametrize('width,height', PHONES + SHORT_PHONES)
def test_on_a_phone_the_panels_bar_ends_inside_the_panel(page: Page, live_server, width, height):
    # "Start recording" was cut through its last letter.
    open_station(page, live_server, width, height)

    assert phone(page)['headRunsOver'] <= 0

