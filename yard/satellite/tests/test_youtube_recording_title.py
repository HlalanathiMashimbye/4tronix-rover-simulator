"""The recording filename and the YouTube linker's title match must agree.

THE GAP THIS FILLS. `recording_control.start_recording` names a file
`<mission>__<yard>__<stamp>.mp4`; `youtubeLinking.ts` on Mission Control reads
an unrenamed upload's title back with its own regex. Nothing ran both and
compared - which is exactly how the two drifted after the stamp was added in
commit cc59aa8: the filename gained a third segment and the title match, still
anchored to exactly two, stopped matching any of them.

This extracts RECORDING_FILENAME_PATTERN out of youtubeLinking.ts, same
approach as test_mission_import.py takes with the run station's regexes, and
runs it against a real filename produced by start_recording rather than a
hand-typed guess at the format.
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import recording_control  # noqa: E402

# .../yard/satellite/tests/this_file.py -> up four to the repository root.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
YOUTUBE_LINKING_TS = os.path.join(
    REPO, 'mission-control', 'src', 'core', 'domain', 'services', 'youtubeLinking.ts')


@pytest.fixture
def recording_filename_pattern():
    """RECORDING_FILENAME_PATTERN, read out of the TypeScript source itself.

    Only the shared subset of regex syntax is exercised here (character
    classes, anchors, a non-capturing group, a lazy quantifier, \\d and {n}),
    which both engines read the same way.
    """
    with open(YOUTUBE_LINKING_TS, encoding='utf-8') as f:
        source = f.read()
    match = re.search(r'const RECORDING_FILENAME_PATTERN = /(.+)/;', source)
    assert match, 'RECORDING_FILENAME_PATTERN is gone from youtubeLinking.ts'
    return re.compile(match.group(1))


@pytest.fixture(autouse=True)
def _isolated_recording_state(tmp_path, monkeypatch):
    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path / 'recordings'))
    monkeypatch.setattr(recording_control, '_writers', {})
    monkeypatch.setattr(recording_control, '_paths', {})
    monkeypatch.setattr(recording_control, '_consumer_thread', None)
    monkeypatch.setattr(recording_control, '_ensure_consumer_started', lambda: None)


class TestRecordingTitleStillMatches:
    def test_a_real_recording_filename_matches_the_linker_title(self, recording_filename_pattern):
        ok, path = recording_control.start_recording('m-7f3a91', 'curiosity')
        assert ok

        title = os.path.splitext(os.path.basename(path))[0]
        match = recording_filename_pattern.match(title)

        assert match, (
            f'{title!r} (produced by start_recording) no longer matches '
            'RECORDING_FILENAME_PATTERN - the recording filename and the '
            'linker title match have drifted again'
        )
        assert match.group(1) == 'm-7f3a91'
        assert match.group(2) == 'curiosity'

    @pytest.mark.parametrize('mission_id', [
        '-BQwFDUWvyhpbQ4ZI8het',    # a real mission's id
        'BQwFDUWvyhpbQ4ZI8he-',     # the same thing at the other end
    ])
    def test_an_id_with_a_dash_at_either_end_comes_back_whole(
            self, recording_filename_pattern, mission_id):
        """The pattern was never the fault here, which is why the id goes
        through recording_key before it is filed, as the web server does.

        Mission ids are nanoid's and a dash is in its alphabet, so about 3 in
        100 start or end with one. recording_key trimmed it, and the title
        still matched: a perfectly good match on the id of a mission that does
        not exist. Asserting only that it matches would have passed.
        """
        ok, path = recording_control.start_recording(
            recording_control.recording_key(mission_id), 'curiosity')
        assert ok

        title = os.path.splitext(os.path.basename(path))[0]
        match = recording_filename_pattern.match(title)

        assert match, f'{title!r} does not match RECORDING_FILENAME_PATTERN'
        assert match.group(1) == mission_id
        assert match.group(2) == 'curiosity'

    def test_an_unstamped_title_still_matches(self, recording_filename_pattern):
        # The shape recordings had before the stamp was added, and what an
        # operator's already-uploaded videos are still titled.
        match = recording_filename_pattern.match('m1__curiosity')
        assert match
        assert match.group(1) == 'm1'
        assert match.group(2) == 'curiosity'

    def test_a_third_segment_that_is_not_the_stamp_is_not_read_as_one(self, recording_filename_pattern):
        # This asserted None until mission ids were allowed their underscores.
        # An id may hold two side by side, so the title now reads as a mission
        # called m1__curiosity, which nothing is. What it must never do is the
        # thing a generic third segment would: claim mission m1 at curiosity.
        match = recording_filename_pattern.match('m1__curiosity__notastamp')
        assert match
        assert match.group(1) == 'm1__curiosity'
        assert match.group(2) == 'notastamp'


class TestEveryIdTheYardCanFileIsReadBack:
    """recording_key keeps underscores, so the linker has to read them back.

    THE SECOND DRIFT, and the same shape as the first. recording_key lets
    `A-Za-z0-9_-` through, which is nanoid's whole alphabet, while the title
    match allowed everything except the underscore. About 28% of mission ids
    have one, so the satellite wrote
    `U3himA_pHY0Ragj_zGYag__curiosity__20261010T124247Z.mp4` and Mission
    Control could not read its own mission id back out of it.

    Each id goes through recording_key first, because that is what the web
    server does to a name before start_recording ever sees it.
    """

    @pytest.mark.parametrize('mission_id', [
        'U3himA_pHY0Ragj_zGYag',    # the real one, 10 October 2026
        'rc6LJehZ3_hLDfM6Fh5MU',    # one underscore
        'V1StGXR8_Z5jdHi6B-myT',    # an underscore and a hyphen
        'rc6LJehZ3ehLDfM6Fh5M_',    # ends in one: three in a row in the filename
        '_c6LJehZ3ehLDfM6Fh5MU',    # starts with one
        'rc6LJehZ3__LDfM6Fh5MU',    # two side by side, which is not the separator
    ])
    def test_the_id_comes_back_whole(self, recording_filename_pattern, mission_id):
        ok, path = recording_control.start_recording(
            recording_control.recording_key(mission_id), 'curiosity')
        assert ok

        title = os.path.splitext(os.path.basename(path))[0]
        match = recording_filename_pattern.match(title)

        assert match, (
            f'{title!r} (produced by start_recording) does not match '
            'RECORDING_FILENAME_PATTERN, so this mission can never be linked '
            'from an unrenamed upload'
        )
        assert match.group(1) == mission_id
        assert match.group(2) == 'curiosity'

    def test_an_id_ending_in_an_underscore_comes_back_from_an_unstamped_title(
            self, recording_filename_pattern):
        match = recording_filename_pattern.match('rc6LJehZ3ehLDfM6Fh5M___curiosity')
        assert match
        assert match.group(1) == 'rc6LJehZ3ehLDfM6Fh5M_'
        assert match.group(2) == 'curiosity'
