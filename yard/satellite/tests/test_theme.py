"""The console opens in the theme Mission Control was showing.

Browser-driven, because the theme is chosen by a script from the handoff URL,
localStorage and the laptop's colour-scheme setting, and what matters is the
colour that ends up on screen. The structural half is in test_palette.py.
"""

from urllib.parse import urlencode

import pytest
from playwright.sync_api import Page

# Mission Control's backgrounds, as its globals.css defines them.
PAPER = 'oklch(0.966 0.006 85)'
DARK = 'oklch(0.13 0.04 270)'
KIOSK_DARK = 'oklch(0.16 0.04 270)'

# Any CSS colour to sRGB through a canvas, because Chromium reports oklch()
# computed values as oklch and they have to be compared as what is painted.
TO_RGB = """(colour) => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
}"""


def rgb(page: Page, colour: str):
    return page.evaluate(TO_RGB, colour)


def same_colour(page: Page, a: str, b: str) -> bool:
    return all(abs(x - y) <= 2 for x, y in zip(rgb(page, a), rgb(page, b)))


def body_background(page: Page) -> str:
    return page.evaluate('getComputedStyle(document.body).backgroundColor')


def theme(page: Page):
    return page.evaluate("document.documentElement.getAttribute('data-theme')")


def handoff(live_server: str, **extra: str) -> str:
    params = {'handoff': 'automatic', 'yardId': 'curiosity', 'missionId': 'm1',
              'missionName': 'Rock Lover', 'code': 'rover.forward(60)', **extra}
    return f'{live_server}/run/?{urlencode(params)}'


def test_a_light_laptop_gets_paper(page: Page, live_server):
    page.emulate_media(color_scheme='light')
    page.goto(f'{live_server}/run/')

    assert theme(page) == 'light'
    assert same_colour(page, body_background(page), PAPER)


def test_a_dark_laptop_gets_mission_controls_dark(page: Page, live_server):
    page.emulate_media(color_scheme='dark')
    page.goto(f'{live_server}/run/')

    assert theme(page) == 'dark'
    assert same_colour(page, body_background(page), DARK)


def test_the_theme_mission_control_hands_over_beats_the_laptop(page: Page, live_server):
    """An operator who picked dark in Mission Control, on a light-mode laptop."""
    page.emulate_media(color_scheme='light')
    page.goto(handoff(live_server, theme='dark'))

    assert theme(page) == 'dark'
    assert same_colour(page, body_background(page), DARK)


def test_the_other_console_pages_keep_the_handed_over_theme(page: Page, live_server):
    """Settings is reached from the run page, not from Mission Control, so it
    has no handoff of its own to read."""
    page.emulate_media(color_scheme='light')
    page.goto(handoff(live_server, theme='dark'))
    page.goto(f'{live_server}/settings')

    assert theme(page) == 'dark'


def test_a_made_up_theme_is_ignored(page: Page, live_server):
    page.emulate_media(color_scheme='light')
    page.goto(handoff(live_server, theme='neon'))

    assert theme(page) == 'light'


@pytest.mark.parametrize('scheme', ['light', 'dark'])
def test_send_to_rover_is_readable_in_both_themes(page: Page, live_server, scheme):
    """Send to rover is Mission Control's ready-to-send green in both themes.
    Its label has to clear 4.5:1 against every colour in the gradient, and the
    button has to stand out from the page behind it."""
    page.emulate_media(color_scheme=scheme)
    page.goto(f'{live_server}/run/')

    # A gradient is a background-image, so read the colours it runs between
    # rather than background-color, which is transparent under it.
    stops, label = page.evaluate(r"""() => {
        const probe = document.createElement('button');
        probe.className = 'btn run-primary';
        probe.textContent = 'Send to rover';
        document.body.appendChild(probe);
        const style = getComputedStyle(probe);
        const image = style.backgroundImage;
        const colours = image && image !== 'none'
            ? image.match(/(oklch|rgba?|color)\([^()]*(\([^()]*\)[^()]*)*\)/g)
            : [style.backgroundColor];
        return [colours, style.color];
    }""")
    assert stops, 'Send to rover has no fill'
    label_rgb = rgb(page, label)
    page_rgb = rgb(page, body_background(page))

    def luminance(c):
        def channel(v):
            v = v / 255
            return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
        r, g, b = (channel(v) for v in c)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    def contrast(a, b):
        hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
        return (hi + 0.05) / (lo + 0.05)

    for stop in stops:
        fill_rgb = rgb(page, stop)
        # The label has to be readable across the whole button, not only
        # where the gradient starts.
        assert contrast(fill_rgb, label_rgb) >= 4.5, f'label on {stop}: {contrast(fill_rgb, label_rgb):.2f}:1'
        # And the button stands out from the page it sits on.
        assert contrast(fill_rgb, page_rgb) >= 3, f'{stop} on page: {contrast(fill_rgb, page_rgb):.2f}:1'


def test_the_tv_monitor_stays_dark_on_a_light_laptop(page: Page, live_server):
    """Kiosk pages opt out: their colours were tuned against the dark palette."""
    page.emulate_media(color_scheme='light')
    page.goto(f'{live_server}/monitor/')

    assert theme(page) is None
    background = page.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--background').trim()")
    assert same_colour(page, background, KIOSK_DARK)


@pytest.mark.parametrize('path', ['/', '/run/', '/settings'])
def test_the_page_links_are_mission_controls_pills_not_underlined_links(page: Page, live_server, path):
    """The console's prose-link rule sat later in the stylesheet than the nav
    and tied with it on specificity, so every page link was underlined.
    Mission Control draws them as a pill group with the current page filled."""
    page.goto(f'{live_server}{path}')

    styles = page.evaluate("""() => [...document.querySelectorAll('.topnav a')].map((a) => ({
        underline: getComputedStyle(a).textDecorationLine,
        active: a.classList.contains('active'),
        fill: getComputedStyle(a).backgroundImage,
    }))""")
    assert styles, 'no page links'
    assert all(s['underline'] == 'none' for s in styles), styles
    active = [s for s in styles if s['active']]
    assert len(active) == 1 and 'gradient' in active[0]['fill'], active
