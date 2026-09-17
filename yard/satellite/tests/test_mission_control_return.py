"""The console's "Mission Control" link returns the operator to where they were.

Browser-driven, because the whole behaviour is a script reading the handoff URL
and localStorage: nothing server-side knows which mission the operator sent.
"""

from urllib.parse import urlencode

from playwright.sync_api import Page

OPERATOR = 'https://marsyard.labs.ws/operator'


def back_href(page: Page) -> str:
    return page.locator('a.mc-back').get_attribute('href')


def handoff(live_server: str, **extra: str) -> str:
    params = {
        'handoff': 'automatic',
        'yardId': 'curiosity',
        'missionId': 'm1',
        'missionName': 'Rock Lover',
        'code': 'rover.forward(60)',
        **extra,
    }
    return f'{live_server}/run/?{urlencode(params)}'


def test_goes_back_to_the_mission_that_was_sent(page: Page, live_server):
    page.goto(handoff(live_server, returnTo=f'{OPERATOR}?mission=m1'))

    assert back_href(page) == f'{OPERATOR}?mission=m1'


def test_remembers_it_on_the_other_console_pages(page: Page, live_server):
    """The operator usually looks at the monitor or settings before going back."""
    page.goto(handoff(live_server, returnTo=f'{OPERATOR}?mission=m1'))
    page.goto(f'{live_server}/settings')

    assert back_href(page) == f'{OPERATOR}?mission=m1'


def test_ignores_an_address_that_is_not_mission_control(page: Page, live_server):
    """returnTo arrives in a URL anyone can craft; following it anywhere would
    make the back button an open redirect."""
    page.goto(handoff(live_server, returnTo='https://evil.example/operator'))

    assert back_href(page) == OPERATOR


def test_ignores_a_script_address(page: Page, live_server):
    page.goto(handoff(live_server, returnTo='javascript:alert(1)'))

    assert back_href(page) == OPERATOR


def test_without_a_handoff_it_is_the_operator_console(page: Page, live_server):
    page.goto(f'{live_server}/run/')

    assert back_href(page) == OPERATOR
