"""The yard's palette is Mission Control's, and the console follows its theme.

The yard used to carry a hand copy of Mission Control's colour tokens. It was
taken from the dark theme once and never updated, so when Mission Control added
its light theme the yard stayed dark, and an operator on a light-mode laptop
went from paper to deep space on pressing Send to Rover.

These are the structural halves: one home for the palette, the right pages
opting into a theme, and nothing that would break offline. What the pages
actually look like is checked in a browser, in test_theme.py.
"""

import re
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parent.parent / 'static'
CONSOLE_PAGES = ('/', '/run/', '/settings')
KIOSK_PAGES = ('/code/', '/monitor/')


@pytest.fixture
def client():
    import web_server
    web_server.app.config['TESTING'] = True
    with web_server.app.test_client() as c:
        yield c


def text(client, path):
    response = client.get(path)
    assert response.status_code == 200, path
    return response.get_data(as_text=True)


def declared(css):
    # Comments out first: a sentence mentioning a token is not a definition.
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    return set(re.findall(r'(--[\w-]+)\s*:', css))


def test_the_palette_is_generated_from_mission_control():
    palette = (STATIC / 'yard-theme.css').read_text()
    assert 'GENERATED FILE' in palette
    # Both of Mission Control's themes, not just the one the old copy had.
    assert re.search(r'^\[data-theme="dark"\]\s*\{', palette, re.M)
    assert re.search(r'^\[data-theme="light"\]\s*\{', palette, re.M)


def test_the_components_get_mission_controls_shapes_too():
    """The yard's cards, buttons and fields are built on Mission Control's
    radius scale and its clay lift, so those come from the same file as the
    colours. A hand-copied radius is how the yard's corners and Mission
    Control's disagreed by 1.6px at every size."""
    tokens = declared((STATIC / 'yard-theme.css').read_text())
    for name in ('--radius', '--radius-lg', '--radius-xl', '--radius-2xl', '--radius-3xl', '--shadow-clay'):
        assert name in tokens, f'yard-theme.css has no {name}'


def test_yard_base_imports_the_palette(client):
    css = text(client, '/static/yard-base.css')
    assert re.search(r"@import url\('yard-theme\.css'\)", css)
    # And it is actually served where that relative import resolves.
    assert '--background' in text(client, '/static/yard-theme.css')


def test_no_token_mission_control_owns_is_defined_again_in_the_yard(client):
    """One home. A second definition is how the old copy drifted: it still
    agreed with the dark theme and silently had no light one."""
    owned = declared((STATIC / 'yard-theme.css').read_text())
    assert '--background' in owned and '--primary' in owned

    sources = {'yard-base.css': text(client, '/static/yard-base.css')}
    sources.update({page: text(client, page) for page in CONSOLE_PAGES})
    for name, source in sources.items():
        redefined = sorted(owned & declared(source))
        assert not redefined, f'{name} redefines {redefined}; they come from yard-theme.css'


@pytest.mark.parametrize('page', CONSOLE_PAGES)
def test_console_pages_choose_a_theme_before_they_paint(client, page):
    html = text(client, page)
    script = html.find('/static/yard-theme-init.js')
    sheet = html.find('/static/yard-base.css')
    assert script != -1, f'{page} does not load the theme script'
    # Before the stylesheet, so the first paint is already the right theme.
    assert script < sheet, f'{page} loads the theme script after its stylesheet'


@pytest.mark.parametrize('page', KIOSK_PAGES)
def test_kiosk_pages_keep_the_dark_palette_they_were_designed_on(client, page):
    """The tablets and the TV are not part of the operator's trip from Mission
    Control, and their own colours were tuned against the dark palette."""
    assert 'yard-theme-init.js' not in text(client, page)


def test_the_offline_editor_caches_the_palette():
    """yard-base.css imports the palette. A tablet that cached one and not the
    other would open /code/ offline with the layout and none of the colours."""
    worker = (STATIC / 'service-worker.js').read_text()
    assets = re.search(r'STATIC_ASSETS\s*=\s*\[(.*?)\]', worker, re.S).group(1)
    assert "'/static/yard-base.css'" in assets
    assert "'/static/yard-theme.css'" in assets


STATUS_LITERALS = re.compile(r'rgba\(\s*(52\s*,\s*211\s*,\s*153|251\s*,\s*191\s*,\s*36|248\s*,\s*113\s*,\s*113)\s*,')


def test_status_tints_follow_the_theme(client):
    """The green, amber and red tints were literals of the dark theme's status
    colours. Left as literals, the light theme deepens the text and keeps a
    tint that no longer matches it."""
    sources = {'yard-base.css': text(client, '/static/yard-base.css')}
    sources.update({page: text(client, page) for page in CONSOLE_PAGES})
    for name, source in sources.items():
        assert not STATUS_LITERALS.search(source), f'{name} hard-codes a status colour; use var(--ok/--warn/--bad)'
