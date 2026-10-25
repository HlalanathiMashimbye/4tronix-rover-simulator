"""The Settings slider for how long a video keeps filming after its run.

A real browser, because what is under test is the slider: that it shows the
value in force and that letting go of it saves the new one.
"""

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402

import tunables  # noqa: E402


def test_it_shows_the_tail_in_force_and_saves_where_it_is_let_go(page: Page, live_server):
    tunables.save({'recordingTail': 5.5})
    page.set_viewport_size({'width': 1366, 'height': 768})
    page.goto(f'{live_server}/settings')
    page.wait_for_function("document.getElementById('tunRecordingTailVal').textContent === '5.5s'")
    assert page.eval_on_selector('#tunRecordingTail', 'el => el.value') == '5.5'

    page.eval_on_selector('#tunRecordingTail', """el => {
        el.value = '7';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }""")
    assert page.text_content('#tunRecordingTailVal') == '7.0s'
    page.wait_for_function("document.getElementById('tunMsg').textContent.startsWith('Saved')")

    assert tunables.get('recordingTail') == 7.0


def test_the_page_still_fits_without_scrolling(page: Page, live_server):
    """Settings is one screen. A new row must not push it into a scroll."""
    page.set_viewport_size({'width': 1366, 'height': 768})
    page.goto(f'{live_server}/settings')
    page.wait_for_selector('#tunRecordingTail')

    assert page.evaluate('document.documentElement.scrollHeight') <= 768
