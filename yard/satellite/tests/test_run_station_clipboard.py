"""Copy and paste on the run station, which the yard serves over plain HTTP.

Browsers only offer the clipboard API on a secure page: HTTPS, or localhost.
The yard serves http://mro.local:3001, so on the machines it runs on the API is
not there. Every Copy used to select its text and ask for Ctrl-C, and the paste
button cannot read the clipboard at all.

These tests run against 127.0.0.1, which browsers count as secure, so the
yard's case is made by taking the API away before the page loads.
"""

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402

# What the yard's browsers have: no secure context, no navigator.clipboard.
PLAIN_HTTP = """
Object.defineProperty(window, 'isSecureContext', { get: () => false });
Object.defineProperty(navigator, 'clipboard', { get: () => undefined });
"""

# Every copy the page makes, as the text that was selected when it made it.
WATCH_COPIES = """
window.__copied = [];
document.addEventListener('copy', (e) => {
    const t = e.target;
    window.__copied.push(t && t.value !== undefined
        ? t.value.slice(t.selectionStart, t.selectionEnd)
        : String(document.getSelection()));
}, true);
"""

MISSION = '# Mission: Rock Lover\n# MissionID: m1\nrover.forward(60)\ntime.sleep(1)\nrover.stop()'


def open_station(page: Page, live_server, *scripts):
    for script in scripts:
        page.add_init_script(script)
    page.goto(f'{live_server}/run/')
    page.wait_for_function("document.getElementById('ytTitle').value !== ''")


def test_on_plain_http_copy_copies_instead_of_asking_for_a_key(page: Page, live_server):
    open_station(page, live_server, PLAIN_HTTP, WATCH_COPIES)
    title = page.input_value('#ytTitle')

    page.click('[data-copy="ytTitle"]')

    assert page.inner_text('[data-copy="ytTitle"]') == 'Copied'
    assert page.evaluate('window.__copied') == [title]


def test_if_the_browser_refuses_even_that_the_text_is_left_selected_with_the_key(page: Page, live_server):
    refuse = "document.execCommand = () => false;"
    open_station(page, live_server, PLAIN_HTTP, refuse)

    page.click('[data-copy="ytTitle"]')

    assert page.inner_text('[data-copy="ytTitle"]') in ('⌘C', 'Ctrl-C')
    selected = page.evaluate(
        "(() => { const f = document.getElementById('ytTitle'); return f.value.slice(f.selectionStart, f.selectionEnd); })()")
    assert selected == page.input_value('#ytTitle')


def test_over_https_copy_still_lands_on_the_clipboard(page: Page, live_server):
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=live_server)
    open_station(page, live_server)

    page.click('[data-copy="ytTitle"]')
    page.wait_for_function("document.querySelector('[data-copy=\"ytTitle\"]').textContent === 'Copied'")

    assert page.evaluate('navigator.clipboard.readText()') == page.input_value('#ytTitle')


def test_on_plain_http_the_paste_button_opens_the_box_ready_to_paste_into(page: Page, live_server):
    """No page on plain HTTP can read the clipboard, so this is the one paste
    there is: the box, focused, naming the one key this machine uses."""
    open_station(page, live_server, PLAIN_HTTP)

    page.click('#importBtn')

    assert page.is_visible('#pasteBox')
    assert page.evaluate('document.activeElement.id') == 'pasteBox'
    assert page.get_attribute('#pasteBox', 'placeholder') in ('Press ⌘V', 'Press Ctrl-V')

    page.evaluate("""(text) => {
        const data = new DataTransfer();
        data.setData('text', text);
        document.getElementById('pasteBox').dispatchEvent(
            new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }""", MISSION)

    assert page.inner_text('#missionName') == 'Rock Lover'
    assert page.inner_text('#missionId') == 'm1'
    assert page.is_hidden('#pasteBox')


def test_on_a_tablet_the_box_says_press_and_hold(browser, live_server):
    context = browser.new_context(has_touch=True, is_mobile=True, viewport={'width': 820, 'height': 1180})
    page = context.new_page()
    try:
        open_station(page, live_server, PLAIN_HTTP)
        page.tap('#importBtn')

        assert page.get_attribute('#pasteBox', 'placeholder') == 'Press and hold here, then tap Paste'
    finally:
        context.close()
