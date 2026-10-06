"""The run station reminds the operator to put the rover on the start mark (AB#465).

A run starts from wherever the rover is standing, and where it is standing is
the one thing none of the run page's checks can see. So the reminder has to be
where Send is pressed: in the live panel's footer, ahead of the Send button,
not in a help page or a side panel an operator reads once.

Asserted on the page's structure, not its wording: a rewrite of the sentence
should not fail this, but moving the reminder away from Send should.
"""

from html.parser import HTMLParser

import pytest

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class _Walk(HTMLParser):
    """Records each element's position and the classes of everything around it."""

    def __init__(self):
        super().__init__()
        self.stack = []
        self.seen = []  # (index, attrs, ancestor classes)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ancestors = {c for _, classes in self.stack for c in classes}
        self.seen.append((len(self.seen), attrs, ancestors))
        if tag not in VOID:
            self.stack.append((tag, (attrs.get('class') or '').split()))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break


@pytest.fixture
def walk():
    import web_server

    web_server.app.config['TESTING'] = True
    with web_server.app.test_client() as client:
        html = client.get('/run/').get_data(as_text=True)
    parsed = _Walk()
    parsed.feed(html)
    return parsed


def _find(walk, predicate):
    found = [entry for entry in walk.seen if predicate(entry[1])]
    assert len(found) == 1, f'expected exactly one, found {len(found)}'
    return found[0]


def test_the_reminder_is_in_the_live_panel_footer_with_send(walk):
    _, _, reminder_around = _find(walk, lambda a: 'data-start-mark-reminder' in a)
    _, _, send_around = _find(walk, lambda a: a.get('id') == 'runBtn')
    assert 'live-foot' in reminder_around
    assert 'live-foot' in send_around


def test_the_reminder_comes_before_send(walk):
    reminder_at, _, _ = _find(walk, lambda a: 'data-start-mark-reminder' in a)
    send_at, _, _ = _find(walk, lambda a: a.get('id') == 'runBtn')
    assert reminder_at < send_at
