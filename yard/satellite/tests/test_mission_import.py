"""The run station's side of the clipboard contract with Mission Control.

Mission Control's Copy button writes the mission's identity into two Python
comments above the code (see mission-control/src/lib/missionClipboard.ts). The
run station parses them back to fill the mission name, the mission id, and from
the id the run id - which is the filename the recording is saved under. A
header that stops parsing therefore does not show up as a broken page; it shows
up later as a video on the satellite that cannot be matched to a mission.

These tests read the regexes out of the page itself rather than restating them,
so editing the page is what they check, and translate them to Python only for
the subset of syntax both engines share.
"""

import re

import pytest


def _js_regex(page, name):
    """Pull `const <name> = /pattern/flags;` out of the template.

    Only the shared subset is translated: character classes, anchors and the
    m flag all mean the same thing in both engines, which is all these use.
    """
    match = re.search(r'const\s+' + name + r'\s*=\s*/(.+)/([a-z]*);', page)
    assert match, f'{name} is gone from the run station'
    pattern, flags = match.group(1), match.group(2)
    return re.compile(pattern, re.M if 'm' in flags else 0)


# Exactly what missionClipboardText produces. Kept as a literal rather than
# built, so that a change to the format on either side breaks this test.
PAYLOAD = '# Mission: Rock Lover\n# MissionID: m1\n\nrover.forward(40)\nrover.stop()'


@pytest.fixture
def page():
    """The rendered run station. Read-only, so it needs no config redirection."""
    import web_server

    web_server.app.config['TESTING'] = True
    with web_server.app.test_client() as client:
        return client.get('/run/').get_data(as_text=True)


class TestClipboardHeaderContract:
    def test_reads_the_name_and_id_mission_control_writes(self, page):
        assert _js_regex(page, 'HEADER_NAME').search(PAYLOAD).group(1) == 'Rock Lover'
        assert _js_regex(page, 'HEADER_ID').search(PAYLOAD).group(1) == 'm1'

    def test_reads_a_payload_that_has_no_name(self, page):
        # A mission with no name still carries its id, and the id is the half
        # that matters: it is what the run id and the filename are built from.
        headerless = '# MissionID: m1\n\nrover.stop()'
        assert _js_regex(page, 'HEADER_NAME').search(headerless) is None
        assert _js_regex(page, 'HEADER_ID').search(headerless).group(1) == 'm1'

    def test_does_not_match_the_words_in_ordinary_code(self, page):
        """The id must come from a header, not from anything that mentions one.

        The upload description this page builds contains the line
        "MissionID: <id>", and an operator pasting that back in would otherwise
        import a mission out of a block of prose.
        """
        prose = 'print("MissionID: not-a-real-id")\n# see MissionID: also-not\n'
        assert _js_regex(page, 'HEADER_ID').search(prose) is None

    def test_the_header_must_start_its_line(self, page):
        """A trailing comment on a line of code is not a header.

        Without the line anchor this matches, and a mission would take its
        identity from a stray comment at the end of some unrelated statement.
        """
        trailing = 'rover.stop()  # MissionID: sneaky\n'
        assert _js_regex(page, 'HEADER_ID').search(trailing) is None
        # The same line at the start of its own line is a header.
        assert _js_regex(page, 'HEADER_ID').search('  # MissionID: fine\n').group(1) == 'fine'

    def test_stops_at_the_end_of_the_line(self, page):
        """A greedy name would swallow the id line and the code with it."""
        got = _js_regex(page, 'HEADER_NAME').search(PAYLOAD).group(1)
        assert '\n' not in got and 'MissionID' not in got

    def test_an_id_with_no_code_is_still_an_import(self, page):
        assert _js_regex(page, 'HEADER_ID').search('# MissionID: abc-123_9').group(1) == 'abc-123_9'


class TestImportNeedsNoDialog:
    def test_the_prompt_dialog_is_gone(self, page):
        """Import used to open window.prompt: a modal typing box mid-run.

        The yard is served over plain HTTP, so navigator.clipboard.readText
        does not exist here and the dialog was the path every operator took,
        every time.
        """
        code = page.split('<script')[-1]
        assert 'window.prompt' not in code

    def test_there_is_somewhere_to_paste(self, page):
        assert 'id="pasteBox"' in page
        # Anchored to a real <label ... for=>, because "for=" also appears
        # inside attributes like data-for= and a substring check passes
        # against markup that has no label at all.
        assert re.search(r'<label[^>]*\sfor="pasteBox"', page), \
            'the paste box needs a label like every other input'

    def test_a_paste_anywhere_imports(self, page):
        assert "addEventListener('paste'" in page

    def test_a_paste_into_a_field_the_operator_edits_is_left_alone(self, page):
        """Pasting an id into the id box should fill the id box, not re-import."""
        assert 'TYPED_FIELDS' in page
        for field in ('code', 'missionName', 'missionId', 'ytDesc'):
            assert f"'{field}'" in page.split('TYPED_FIELDS')[1].split(']')[0]
