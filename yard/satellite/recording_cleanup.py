"""
Prune recordings once they have served their purpose.

The satellite's SD card is a cache before upload, not an archive. Recordings
accumulate at ~87KB/s (~7.5GB/day) and nothing else removes them, so an event
day will eventually fill the card and recording will fail silently.

Three rules, applied in order:
1. Grace expiry  — downloaded and older than cleanupGracePeriod → delete.
2. Max age       — older than cleanupMaxAge regardless → delete.
3. Headroom guard — free space below cleanupMinFreeGB → delete oldest
   downloaded first, then oldest undownloaded.

A recording that is currently being written is never deleted, no matter what.

Download state is tracked by marker files: when an operator downloads
mission.mp4, a zero-byte mission.mp4.downloaded is created beside it. The
marker's mtime is the download time. Atomic, crash-safe, no locking needed.
"""

import logging
import os
import shutil
import time
from datetime import datetime, timezone

import tunables
from recording_control import RECORDINGS_DIR, active_paths

logger = logging.getLogger(__name__)

MARKER_SUFFIX = '.downloaded'


def mark_downloaded(recording_path):
    """Create a .downloaded marker beside the recording. Idempotent."""
    marker = recording_path + MARKER_SUFFIX
    try:
        with open(marker, 'w') as f:
            pass
    except OSError as e:
        logger.warning('Could not mark %s as downloaded: %s',
                       os.path.basename(recording_path), e)


def is_downloaded(recording_path):
    """(downloaded, downloaded_at) from the marker file's existence and mtime."""
    marker = recording_path + MARKER_SUFFIX
    try:
        st = os.stat(marker)
        dt = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc)
        return True, dt
    except OSError:
        return False, None


def disk_stats(path=None):
    """Total, free and used bytes for the filesystem holding path."""
    target = path or RECORDINGS_DIR
    try:
        usage = shutil.disk_usage(target)
        return {
            'total_bytes': usage.total,
            'free_bytes': usage.free,
            'used_bytes': usage.used,
        }
    except OSError:
        return {'total_bytes': 0, 'free_bytes': 0, 'used_bytes': 0}


def _recording_files():
    """All .mp4 files in the recordings directory, as absolute paths."""
    try:
        names = os.listdir(RECORDINGS_DIR)
    except OSError:
        return []
    return [
        os.path.join(RECORDINGS_DIR, n)
        for n in names if n.endswith('.mp4')
    ]


def _delete(path, reason):
    """Delete the .mp4 and its .downloaded marker if present. Log both."""
    name = os.path.basename(path)
    try:
        os.remove(path)
        logger.info('Cleanup: deleted %s (%s)', name, reason)
    except OSError as e:
        logger.warning('Cleanup: could not delete %s: %s', name, e)
        return False

    marker = path + MARKER_SUFFIX
    try:
        os.remove(marker)
    except OSError:
        pass
    return True


def sweep():
    """One cleanup pass. Returns names of deleted files. Never raises."""
    try:
        return _sweep()
    except Exception as e:
        logger.warning('Cleanup sweep failed: %s', e)
        return []


def _sweep():
    grace_hours = tunables.get('cleanupGracePeriod')
    max_days = tunables.get('cleanupMaxAge')
    min_free_gb = tunables.get('cleanupMinFreeGB')

    now = time.time()
    grace_seconds = grace_hours * 3600
    max_seconds = max_days * 86400
    min_free_bytes = min_free_gb * (1024 ** 3)

    protected = active_paths()
    files = _recording_files()

    deleted = []
    survivors = []

    for path in files:
        if path in protected:
            continue

        try:
            file_mtime = os.stat(path).st_mtime
        except OSError:
            continue

        file_age = now - file_mtime
        downloaded, dl_at = is_downloaded(path)

        # Rule 1: downloaded and past the grace period
        if downloaded and dl_at is not None:
            dl_age = now - dl_at.timestamp()
            if dl_age >= grace_seconds:
                if _delete(path, 'downloaded %d hours ago' % int(dl_age / 3600)):
                    deleted.append(os.path.basename(path))
                continue

        # Rule 2: older than max age regardless
        if file_age >= max_seconds:
            if _delete(path, '%d days old' % int(file_age / 86400)):
                deleted.append(os.path.basename(path))
            continue

        survivors.append((path, file_mtime, downloaded))

    # Rule 3: headroom guard
    stats = disk_stats()
    if stats['free_bytes'] >= min_free_bytes:
        return deleted

    # Delete oldest downloaded first, then oldest undownloaded
    downloaded_survivors = sorted(
        [(p, mt) for p, mt, dl in survivors if dl],
        key=lambda x: x[1],
    )
    undownloaded_survivors = sorted(
        [(p, mt) for p, mt, dl in survivors if not dl],
        key=lambda x: x[1],
    )

    for batch_label, batch in [('headroom, downloaded', downloaded_survivors),
                               ('headroom, undownloaded', undownloaded_survivors)]:
        for path, _mt in batch:
            if disk_stats()['free_bytes'] >= min_free_bytes:
                return deleted
            if _delete(path, batch_label):
                deleted.append(os.path.basename(path))

    return deleted
