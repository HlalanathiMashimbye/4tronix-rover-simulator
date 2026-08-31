"""
Recording mission video from the camera's live broadcast.

BACKLOG 334/335/336/338. The camera process (camera_server.py) already
broadcasts a live JPEG stream over WebSocket for the TV monitor; this module
is just another client of that same broadcast. It never touches the camera
device directly, so a recording never competes with the live monitor feed (or
with a second recording) for the hardware - it costs the camera exactly one
extra broadcast subscriber, however many runs are being recorded.

One shared consumer thread feeds every run's file. A dict keyed by
(mission_id, yard_id) - matching how the run model itself is keyed
(runs_mirror's primary key) - not a single "current recording" variable, is
what makes that safe: nothing stops a second "Send to rover" while an earlier
run is still 'processing' at a different yard, so two recordings can be
genuinely simultaneous.

cv2/numpy are imported lazily inside functions, never at module top:
requirements-test.txt deliberately excludes opencv-python/numpy to keep CI
light, and this module is imported from operator_console.py and
mission_watcher.py, both covered by that suite.
"""

import asyncio
import base64
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

import websockets
import tunables

logger = logging.getLogger(__name__)

SATELLITE_DIR = os.path.dirname(os.path.abspath(__file__))

FPS = 15.0  # matches camera_server.py's frame_producer interval (1/15s)

# How recent _last_frame_at must be for is_ready() to trust it instead of
# opening a second, competing probe connection.
_FRESH_FRAME_SECONDS = 3.0


def _recording_dir():
    return os.environ.get('RECORDING_DIR') or os.path.join(SATELLITE_DIR, 'recordings')


def _camera_uri():
    host = tunables.get('cameraHost')
    port = int(os.environ.get('CAMERA_PORT', 8890))
    return f'ws://{host}:{port}'


def _ready_timeout():
    return tunables.get('cameraReadyTimeout')


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


_lock = threading.Lock()
_writers = {}   # (mission_id, yard_id) -> cv2.VideoWriter, or None while awaiting the first frame
_paths = {}     # (mission_id, yard_id) -> file path, for runs currently recording
_consumer_thread = None
_last_frame_at = None


def is_ready(timeout=None):
    """(bool, detail). BACKLOG 334.

    Proves frames are actually flowing, not just that the port accepts a TCP
    connection (camera_control.is_listening only proves that). If a recording
    is already active, its own live frame-arrival is reused as proof rather
    than opening a second competing client.
    """
    with _lock:
        fresh = (
            _last_frame_at is not None
            and (time.monotonic() - _last_frame_at) < _FRESH_FRAME_SECONDS
        )
    if fresh:
        return True, None

    timeout = _ready_timeout() if timeout is None else timeout

    async def probe():
        try:
            async with websockets.connect(_camera_uri(), open_timeout=timeout) as ws:
                message = await asyncio.wait_for(ws.recv(), timeout=timeout)
        except (OSError, asyncio.TimeoutError, websockets.exceptions.WebSocketException) as e:
            return False, f'could not reach the camera: {e}'

        try:
            payload = json.loads(message)
        except (TypeError, ValueError):
            return False, 'camera sent something that was not a frame'
        if payload.get('type') != 'frame':
            return False, 'camera sent something that was not a frame'
        return True, None

    try:
        return asyncio.run(probe())
    except Exception as e:
        return False, f'readiness probe failed: {e}'


def start_recording(mission_id, yard_id):
    """(bool, detail). Begin persisting frames for this run.

    Best-effort: the caller must NOT fail its HTTP response on a False here -
    by the time this runs the rover has already been dispatched, which is
    irreversible. The video writer itself is opened lazily by the consumer
    thread on the first real frame, sized to match that frame exactly, rather
    than guessed here.
    """
    try:
        os.makedirs(_recording_dir(), exist_ok=True)
    except OSError as e:
        return False, f'could not create the recording directory: {e}'

    key = (mission_id, yard_id)
    path = os.path.join(_recording_dir(), f'{mission_id}__{yard_id}.mp4')

    with _lock:
        _writers[key] = None
        _paths[key] = path
        _ensure_consumer_started()

    return True, path


def stop_recording(mission_id, yard_id, keep):
    """(bool, detail). Stop this run's recording, keeping or discarding it.

    Idempotent, and handles two different shapes of "stop":
      - An actively-writing recording: close the writer, then keep or delete
        the file.
      - An already-stopped, currently-'kept' recording (no writer open - the
        post-hoc discard used when an operator resolves a review as
        'cancelled' or 'requeue'): keep=False deletes the file directly.
    A run with nothing to do returns (True, 'not recording') rather than
    raising, so every call site (watcher, stop, resolve) can call this
    unconditionally.
    """
    from mission_store import get_run, set_run_recording_state

    key = (mission_id, yard_id)
    with _lock:
        writer = _writers.pop(key, None)
        path = _paths.pop(key, None)

    if writer is not None:
        try:
            writer.release()
        except Exception as e:
            logger.warning('Error closing the recording writer for %s/%s: %s', mission_id, yard_id, e)

    if path is None:
        run = get_run(mission_id, yard_id)
        recording_status = (run or {}).get('recording_status') or 'none'
        path = (run or {}).get('recording_path')
        if recording_status in ('none', 'discarded'):
            return True, 'not recording'

    now = _now_iso()

    if keep:
        set_run_recording_state(mission_id, yard_id, 'kept', stopped_at=now)
        return True, path

    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError as e:
            logger.warning('Could not delete the recording for %s/%s: %s', mission_id, yard_id, e)

    set_run_recording_state(mission_id, yard_id, 'discarded', stopped_at=now)
    return True, path


def _ensure_consumer_started():
    """Must be called while holding _lock."""
    global _consumer_thread
    if _consumer_thread is None or not _consumer_thread.is_alive():
        _consumer_thread = threading.Thread(
            target=_consumer_loop, name='recording-consumer', daemon=True,
        )
        _consumer_thread.start()


def _decode_frame(message):
    import cv2
    import numpy as np

    try:
        payload = json.loads(message)
        if payload.get('type') != 'frame':
            return None
        data = payload.get('data')
        if not data:
            return None
        jpg = base64.b64decode(data)
        arr = np.frombuffer(jpg, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        return None


def _write_frame_to_all(frame):
    import cv2

    height, width = frame.shape[:2]
    with _lock:
        items = list(_writers.items())

    for key, writer in items:
        if writer is None:
            path = _paths.get(key)
            if not path:
                continue
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            new_writer = cv2.VideoWriter(path, fourcc, FPS, (width, height))
            with _lock:
                # Still wanted? stop_recording may have removed it while the
                # writer above was opening.
                if key in _writers:
                    _writers[key] = new_writer
                    writer = new_writer
                else:
                    new_writer.release()
                    continue
        try:
            writer.write(frame)
        except Exception as e:
            logger.warning('Failed writing a frame for %s: %s', key, e)


def _consumer_loop():
    global _last_frame_at, _consumer_thread

    async def run():
        global _last_frame_at
        try:
            async with websockets.connect(_camera_uri()) as ws:
                async for message in ws:
                    frame = _decode_frame(message)
                    if frame is not None:
                        _last_frame_at = time.monotonic()
                        _write_frame_to_all(frame)
                    with _lock:
                        if not _writers:
                            return
        except Exception as e:
            logger.warning('Recording consumer connection ended: %s', e)

    try:
        asyncio.run(run())
    finally:
        with _lock:
            _consumer_thread = None
