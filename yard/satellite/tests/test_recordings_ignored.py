"""Nothing the satellite writes beside a recording shows up in git.

The satellite runs from a git checkout, and an empty `git status --porcelain`
is how the runbook tells a Pi serving stale code from one that is not
(AGENTS.md). Each kind of file written into recordings/ broke that once: the
.downloaded markers first, then the upload notes, found on the Pi on 24
October 2026 after its first automatic upload.
"""

import os
import shutil
import subprocess

import pytest

from recording_cleanup import MARKER_SUFFIX
from recording_control import RECORDINGS_DIR
from youtube_upload import NOTE_SUFFIX

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
VIDEO = 'zAHtPQvGW-_upbuw9NAeh__curiosity__20261024T141312Z.mp4'


# .git is a file, not a folder, in a worktree.
@pytest.mark.skipif(shutil.which('git') is None or not os.path.exists(os.path.join(REPO, '.git')),
                    reason='not a git checkout')
def test_every_file_written_beside_a_recording_is_ignored():
    written = [
        VIDEO,
        VIDEO + MARKER_SUFFIX,
        VIDEO + NOTE_SUFFIX,
        # _write_note writes the note through a temporary file and renames it.
        VIDEO + NOTE_SUFFIX + '.tmp',
    ]
    paths = [os.path.relpath(os.path.join(RECORDINGS_DIR, name), REPO) for name in written]

    result = subprocess.run(['git', 'check-ignore', '--no-index', *paths],
                            cwd=REPO, capture_output=True, text=True)

    assert set(result.stdout.split()) == set(paths), result.stdout
