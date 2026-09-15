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
    classes, anchors, a non-capturing group, \\d and {n}), which both engines
    read the same way.
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

    def test_an_unstamped_title_still_matches(self, recording_filename_pattern):
        # The shape recordings had before the stamp was added, and what an
        # operator's already-uploaded videos are still titled.
        match = recording_filename_pattern.match('m1__curiosity')
        assert match
        assert match.group(1) == 'm1'
        assert match.group(2) == 'curiosity'

    def test_a_third_segment_that_is_not_the_stamp_does_not_match(self, recording_filename_pattern):
        assert recording_filename_pattern.match('m1__curiosity__notastamp') is None
