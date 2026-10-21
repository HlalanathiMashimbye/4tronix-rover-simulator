"""Repointing a yard at a different Mission Control, from the Settings page.

The address used to be a line in a file on the Pi. It is a setting now, in a
dialog off the Settings header, and the top bar's Mission Control link follows
it on the same page, without a reload or a restart.
"""

import pytest

pytest.importorskip('playwright')
from playwright.sync_api import Page  # noqa: E402


def open_dialog(page: Page, live_server):
    page.goto(f'{live_server}/settings')
    page.click('#mcBtn')
    page.wait_for_selector('#mcDialog[open]')
    # Filled from what is in force, so Use with nothing typed keeps it.
    page.wait_for_function("document.getElementById('tunMissionControl').value !== ''")


def back_link(page: Page):
    return page.get_attribute('.mc-back', 'href')


def test_the_dialog_starts_on_the_address_in_force(page: Page, live_server, monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    open_dialog(page, live_server)

    assert page.input_value('#tunMissionControl') == 'https://marsyard.sapient.rocks'


def test_use_repoints_the_link_on_this_page_and_after_a_reload(page: Page, live_server, monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    open_dialog(page, live_server)

    page.fill('#tunMissionControl', 'marsyard.labs.ws')
    page.click('#mcSave')
    page.wait_for_selector('#mcMsg[data-tone="ok"]')

    assert back_link(page) == 'https://marsyard.labs.ws/operator'
    page.reload()
    assert back_link(page) == 'https://marsyard.labs.ws/operator'


def test_a_mistyped_address_says_so_and_leaves_the_yard_where_it_was(page: Page, live_server, monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    open_dialog(page, live_server)

    page.fill('#tunMissionControl', 'marsyard sapient rocks')
    page.click('#mcSave')
    page.wait_for_selector('#mcMsg[data-tone="bad"]')

    assert page.is_visible('#mcDialog')
    page.reload()
    assert back_link(page) == 'https://marsyard.sapient.rocks/operator'


def test_escape_closes_it_without_saving(page: Page, live_server, monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    open_dialog(page, live_server)

    page.fill('#tunMissionControl', 'marsyard.labs.ws')
    page.keyboard.press('Escape')

    assert not page.is_visible('#mcDialog')
    page.reload()
    assert back_link(page) == 'https://marsyard.sapient.rocks/operator'
