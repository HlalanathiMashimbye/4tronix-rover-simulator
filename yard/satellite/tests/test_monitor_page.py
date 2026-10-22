"""The TV monitor: the camera's picture, all of it, on whatever screen it is.

The camera is 4:3 and a television is 16:9. The monitor gave the camera two
thirds of the screen whatever its shape and drew the picture to that width,
so on a 1080p television the picture was 1139px tall on a screen of 1080 less
its header: the yard's near wall was off the foot of the screen. Reported on
13 October 2026 as "it didn't seem to fit nicely".

These drive a real browser, because the thing under test is a layout.
"""

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402

TELEVISIONS = [(1920, 1080), (1366, 768), (1280, 720), (3840, 2160)]
SQUARER = [(1024, 768), (1280, 1024)]


def open_monitor(page: Page, live_server, width, height):
    page.set_viewport_size({'width': width, 'height': height})
    page.goto(f'{live_server}/monitor/')
    page.wait_for_selector('#cameraCanvas')


def picture(page: Page):
    """Where the camera's picture is actually drawn, and the screen it is on.

    The canvas is fitted inside its box (object-fit: contain), so the picture
    is the largest 4:3 rectangle that fits the box, centred in it.
    """
    return page.evaluate("""() => {
        const canvas = document.getElementById('cameraCanvas');
        const box = canvas.getBoundingClientRect();
        const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
        const width = canvas.width * scale, height = canvas.height * scale;
        const left = box.left + (box.width - width) / 2;
        const top = box.top + (box.height - height) / 2;
        return {
            left, top, right: left + width, bottom: top + height, width, height,
            box: { left: box.left, top: box.top, width: box.width, height: box.height },
            screen: { width: innerWidth, height: innerHeight },
            fit: getComputedStyle(canvas).objectFit,
        };
    }""")


@pytest.mark.parametrize('width,height', TELEVISIONS + SQUARER)
def test_the_whole_picture_is_on_the_screen(page: Page, live_server, width, height):
    open_monitor(page, live_server, width, height)

    shown = picture(page)

    assert shown['fit'] == 'contain'
    assert shown['top'] >= 0 and shown['left'] >= 0
    assert shown['bottom'] <= shown['screen']['height'] + 0.5, \
        f"the foot of the picture is at {shown['bottom']:.0f} on a screen {height} tall"
    assert shown['right'] <= shown['screen']['width'] + 0.5


@pytest.mark.parametrize('width,height', TELEVISIONS)
def test_on_a_television_the_picture_fills_its_panel_with_nothing_beside_it(page: Page, live_server, width, height):
    open_monitor(page, live_server, width, height)

    shown = picture(page)

    # The panel is the picture's shape, so fitting the picture in it leaves
    # no strip at either side and none above or below.
    assert abs(shown['width'] - shown['box']['width']) <= 2
    assert abs(shown['height'] - shown['box']['height']) <= 2
    # And it is as tall as the screen allows: everything under the header.
    header = page.evaluate("document.querySelector('.camera-header').getBoundingClientRect().height")
    assert abs(shown['height'] - (height - header)) <= 2


@pytest.mark.parametrize('width,height', TELEVISIONS + SQUARER)
def test_the_picture_and_the_queue_have_the_whole_screen_between_them(page: Page, live_server, width, height):
    # The queue takes what the picture leaves. Capped, as it was at 400px, it
    # left a strip of nothing down the side of a television.
    open_monitor(page, live_server, width, height)

    camera, queue = page.evaluate("""() => ['.camera-panel', '.queue-panel'].map(
        (s) => document.querySelector(s).getBoundingClientRect().width)""")

    assert abs(camera + queue - width) <= 1


@pytest.mark.parametrize('width,height', SQUARER)
def test_on_a_squarer_screen_the_queue_keeps_its_width_and_the_picture_is_fitted(page: Page, live_server, width, height):
    open_monitor(page, live_server, width, height)

    queue = page.evaluate("document.querySelector('.queue-panel').getBoundingClientRect().width")
    shown = picture(page)

    assert queue >= 340
    # Still the camera's shape, never stretched to the panel's.
    assert abs(shown['width'] / shown['height'] - 4 / 3) < 0.01


@pytest.mark.parametrize('width,height', TELEVISIONS + SQUARER)
def test_the_two_bars_along_the_top_are_one_line(page: Page, live_server, width, height):
    open_monitor(page, live_server, width, height)

    camera, queue = page.evaluate("""() => ['.camera-header', '.queue-header'].map(
        (s) => document.querySelector(s).getBoundingClientRect().height)""")

    assert camera == queue


@pytest.mark.parametrize('width,height', TELEVISIONS + SQUARER)
def test_the_monitor_never_scrolls(page: Page, live_server, width, height):
    open_monitor(page, live_server, width, height)

    overflow = page.evaluate("""() => ({
        wide: document.documentElement.scrollWidth - innerWidth,
        tall: document.documentElement.scrollHeight - innerHeight,
    })""")

    assert overflow == {'wide': 0, 'tall': 0}


# --- How sharp the picture is -------------------------------------------------
# Settings offers the camera at three sizes, "so it fills a big screen
# better". The canvas was a fixed 640 x 480 and every frame was drawn down to
# that, so on the monitor the two sharper settings changed nothing.

FRAME = """async (size) => {
    const [width, height] = size;
    const source = document.createElement('canvas');
    source.width = width; source.height = height;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#804020'; ctx.fillRect(0, 0, width, height);
    const jpeg = source.toDataURL('image/jpeg').split(',')[1];
    const camera = window.__yardMonitorHooks.camera;
    // Stood down first: a machine with a camera running would send its own
    // frames between ours and the reading, and the canvas would be its size.
    camera.disable();
    camera.displayFrame(jpeg);
    const canvas = document.getElementById('cameraCanvas');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pixel = canvas.getContext('2d').getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data;
    return { width: canvas.width, height: canvas.height, drawnToTheCorner: pixel[0] > 90 && pixel[3] === 255 };
}"""


@pytest.mark.parametrize('size', [[640, 480], [1280, 960], [1920, 1440]])
def test_the_canvas_has_as_many_pixels_as_the_frame(page: Page, live_server, size):
    open_monitor(page, live_server, 1920, 1080)

    drawn = page.evaluate(FRAME, size)

    assert [drawn['width'], drawn['height']] == size
    assert drawn['drawnToTheCorner'], 'the frame does not cover the canvas'


def test_a_sharper_frame_does_not_change_how_big_the_picture_is_shown(page: Page, live_server):
    open_monitor(page, live_server, 1920, 1080)
    before = picture(page)

    page.evaluate(FRAME, [1280, 960])
    after = picture(page)

    assert abs(after['width'] - before['width']) <= 1
    assert abs(after['height'] - before['height']) <= 1
