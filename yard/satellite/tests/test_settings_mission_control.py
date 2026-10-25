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


# --- The upload secret, in the same dialog ----------------------------------

SECRET = 'S' * 24 + 'x9Kq-Lw2_Zp7Rt4Vb8Nm3Jh6'


@pytest.fixture
def no_secret(monkeypatch):
    import youtube_upload
    monkeypatch.delenv('YOUTUBE_UPLOAD_INGEST_SECRET', raising=False)
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    monkeypatch.setattr(youtube_upload, 'kick', lambda: None)


def secret_state(page: Page):
    return page.inner_text('#mcSecretState')


def test_the_secret_is_set_here_and_never_shown_again(page: Page, live_server, no_secret):
    open_dialog(page, live_server)
    assert secret_state(page).startswith('Not set')

    page.fill('#mcSecret', SECRET)
    page.click('#mcSave')
    page.wait_for_selector('#mcMsg[data-tone="ok"]')

    assert secret_state(page) == 'Set for marsyard.sapient.rocks'
    assert page.input_value('#mcSecret') == ''
    page.reload()
    open_dialog(page, live_server)
    assert page.input_value('#mcSecret') == ''
    assert secret_state(page) == 'Set for marsyard.sapient.rocks'
    assert SECRET not in page.content()


def test_a_new_address_asks_for_the_secret_again(page: Page, live_server, no_secret):
    open_dialog(page, live_server)
    page.fill('#mcSecret', SECRET)
    page.click('#mcSave')
    page.wait_for_selector('#mcMsg[data-tone="ok"]')

    page.fill('#tunMissionControl', 'marsyard.labs.ws')
    page.click('#mcSave')
    page.wait_for_function("document.getElementById('mcSecretState').textContent.startsWith('Was for')")

    assert 'marsyard.sapient.rocks' in secret_state(page)
    assert page.get_attribute('#mcSecretState', 'data-tone') == 'warn'


def test_a_wrong_secret_says_so_and_sets_nothing(page: Page, live_server, no_secret):
    open_dialog(page, live_server)
    page.fill('#mcSecret', 'too short')
    page.click('#mcSave')
    page.wait_for_selector('#mcMsg[data-tone="bad"]')

    assert secret_state(page).startswith('Not set')


def test_remove_turns_automatic_upload_off(page: Page, live_server, no_secret):
    open_dialog(page, live_server)
    assert page.is_hidden('#mcRemoveSecret')
    page.fill('#mcSecret', SECRET)
    page.click('#mcSave')
    page.wait_for_selector('#mcRemoveSecret:not([hidden])')

    page.click('#mcRemoveSecret')
    page.wait_for_function("document.getElementById('mcSecretState').textContent.startsWith('Not set')")

    assert page.is_hidden('#mcRemoveSecret')
