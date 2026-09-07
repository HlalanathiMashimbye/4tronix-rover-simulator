"""Tests for recording_cleanup — marker files, sweep rules, headroom guard."""

import os
import time

import pytest

import recording_cleanup
from recording_cleanup import (
    mark_downloaded, is_downloaded, disk_stats, sweep, MARKER_SUFFIX,
)


@pytest.fixture(autouse=True)
def _use_tmp_recordings(tmp_path, monkeypatch):
    """Point every test at a throwaway recordings directory."""
    rec_dir = tmp_path / 'recordings'
    rec_dir.mkdir()
    monkeypatch.setattr(recording_cleanup, 'RECORDINGS_DIR', str(rec_dir))
    # No active recordings by default; individual tests override.
    monkeypatch.setattr(recording_cleanup, 'active_paths', lambda: set())
    return rec_dir


@pytest.fixture
def rec_dir(tmp_path):
    return tmp_path / 'recordings'


def _make_recording(rec_dir, name='test__yard__20260901T120000Z.mp4',
                    age_seconds=0):
    """Create a fake .mp4 and backdate it."""
    path = rec_dir / name
    path.write_bytes(b'\x00' * 1024)
    if age_seconds:
        old = time.time() - age_seconds
        os.utime(path, (old, old))
    return str(path)


def _make_marker(path, age_seconds=0):
    marker = path + MARKER_SUFFIX
    with open(marker, 'w'):
        pass
    if age_seconds:
        old = time.time() - age_seconds
        os.utime(marker, (old, old))
    return marker


# ---- mark_downloaded / is_downloaded ----

class TestMarkerFiles:
    def test_mark_downloaded_creates_a_marker(self, rec_dir):
        path = _make_recording(rec_dir)
        mark_downloaded(path)
        assert os.path.exists(path + MARKER_SUFFIX)

    def test_mark_downloaded_is_idempotent(self, rec_dir):
        path = _make_recording(rec_dir)
        mark_downloaded(path)
        mark_downloaded(path)
        assert os.path.exists(path + MARKER_SUFFIX)

    def test_is_downloaded_returns_false_for_unmarked_files(self, rec_dir):
        path = _make_recording(rec_dir)
        dl, dt = is_downloaded(path)
        assert dl is False
        assert dt is None

    def test_is_downloaded_returns_true_with_timestamp(self, rec_dir):
        path = _make_recording(rec_dir)
        mark_downloaded(path)
        dl, dt = is_downloaded(path)
        assert dl is True
        assert dt is not None


# ---- disk_stats ----

class TestDiskStats:
    def test_returns_expected_keys(self, rec_dir):
        stats = disk_stats(str(rec_dir))
        assert 'total_bytes' in stats
        assert 'free_bytes' in stats
        assert 'used_bytes' in stats
        assert stats['total_bytes'] > 0


# ---- sweep rules ----

class TestSweepGraceExpiry:
    def test_deletes_downloaded_files_past_grace_period(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', lambda name: {
            'cleanupGracePeriod': 24.0,
            'cleanupMaxAge': 21.0,
            'cleanupMinFreeGB': 0.0,
        }[name])
        path = _make_recording(rec_dir, age_seconds=3600)
        _make_marker(path, age_seconds=90000)  # 25 hours ago
        deleted = sweep()
        assert len(deleted) == 1
        assert not os.path.exists(path)

    def test_keeps_downloaded_files_within_grace_period(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', lambda name: {
            'cleanupGracePeriod': 24.0,
            'cleanupMaxAge': 21.0,
            'cleanupMinFreeGB': 0.0,
        }[name])
        path = _make_recording(rec_dir, age_seconds=3600)
        _make_marker(path, age_seconds=3600)  # 1 hour ago, within 24h grace
        deleted = sweep()
        assert len(deleted) == 0
        assert os.path.exists(path)


class TestSweepMaxAge:
    def test_deletes_old_undownloaded_files(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', lambda name: {
            'cleanupGracePeriod': 72.0,
            'cleanupMaxAge': 21.0,
            'cleanupMinFreeGB': 0.0,
        }[name])
        path = _make_recording(rec_dir, age_seconds=22 * 86400)  # 22 days
        deleted = sweep()
        assert len(deleted) == 1
        assert not os.path.exists(path)

    def test_keeps_files_within_max_age(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', lambda name: {
            'cleanupGracePeriod': 72.0,
            'cleanupMaxAge': 21.0,
            'cleanupMinFreeGB': 0.0,
        }[name])
        path = _make_recording(rec_dir, age_seconds=5 * 86400)  # 5 days
        deleted = sweep()
        assert len(deleted) == 0
        assert os.path.exists(path)


class TestSweepActiveProtection:
    def test_never_deletes_an_active_recording(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', lambda name: {
            'cleanupGracePeriod': 72.0,
            'cleanupMaxAge': 21.0,
            'cleanupMinFreeGB': 0.0,
        }[name])
        path = _make_recording(rec_dir, age_seconds=30 * 86400)  # very old
        monkeypatch.setattr(recording_cleanup, 'active_paths', lambda: {path})
        deleted = sweep()
        assert len(deleted) == 0
        assert os.path.exists(path)


class TestSweepMarkerCleanup:
    def test_deletes_the_marker_alongside_the_mp4(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', lambda name: {
            'cleanupGracePeriod': 24.0,
            'cleanupMaxAge': 21.0,
            'cleanupMinFreeGB': 0.0,
        }[name])
        path = _make_recording(rec_dir, age_seconds=3600)
        marker = _make_marker(path, age_seconds=90000)
        sweep()
        assert not os.path.exists(path)
        assert not os.path.exists(marker)


class TestSweepHeadroomGuard:
    def _fake_tunables(self, name):
        return {
            'cleanupGracePeriod': 720.0,  # very long, so rules 1+2 don't trigger
            'cleanupMaxAge': 60.0,
            'cleanupMinFreeGB': 2.0,
        }[name]

    def _low_disk(self, *args, **kwargs):
        return {'total_bytes': 64 * (1024**3), 'free_bytes': 1 * (1024**3),
                'used_bytes': 63 * (1024**3)}

    def _enough_disk(self, *args, **kwargs):
        return {'total_bytes': 64 * (1024**3), 'free_bytes': 10 * (1024**3),
                'used_bytes': 54 * (1024**3)}

    def test_deletes_downloaded_first_under_pressure(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', self._fake_tunables)

        old = _make_recording(rec_dir, name='old__y__20260801T000000Z.mp4',
                              age_seconds=3600)
        _make_marker(old, age_seconds=60)  # downloaded recently
        new = _make_recording(rec_dir, name='new__y__20260802T000000Z.mp4',
                              age_seconds=1800)
        # new is NOT downloaded

        calls = [0]
        def disk_after_delete(*a, **kw):
            calls[0] += 1
            if calls[0] <= 2:
                return self._low_disk()
            return self._enough_disk()

        monkeypatch.setattr(recording_cleanup, 'disk_stats', disk_after_delete)
        deleted = sweep()
        assert os.path.basename(old) in deleted
        assert os.path.exists(new)  # undownloaded kept

    def test_deletes_undownloaded_if_still_critical(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', self._fake_tunables)

        path = _make_recording(rec_dir, age_seconds=3600)
        # NOT downloaded

        monkeypatch.setattr(recording_cleanup, 'disk_stats', self._low_disk)
        deleted = sweep()
        assert len(deleted) == 1

    def test_headroom_guard_skips_active_recordings(self, rec_dir, monkeypatch):
        monkeypatch.setattr('tunables.get', self._fake_tunables)

        path = _make_recording(rec_dir, age_seconds=3600)
        monkeypatch.setattr(recording_cleanup, 'active_paths', lambda: {path})
        monkeypatch.setattr(recording_cleanup, 'disk_stats', self._low_disk)
        deleted = sweep()
        assert len(deleted) == 0
        assert os.path.exists(path)


class TestSweepNeverRaises:
    def test_survives_a_broken_recordings_directory(self, monkeypatch):
        monkeypatch.setattr(recording_cleanup, 'RECORDINGS_DIR', '/no/such/dir')
        result = sweep()
        assert result == []
