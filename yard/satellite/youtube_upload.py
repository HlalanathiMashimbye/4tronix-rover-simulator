"""Delivering closed recordings to Mission Control, which uploads them to YouTube.

AN OUTBOX, NOT THREE TRIES. Delivery used to try three times in the few
seconds after a run ended and then give up for good. While the satellite
serves the yard's wifi it has no internet at all (yard/docs/yard-network.md),
so in the yard as it is normally set up every one of those tries failed and
nothing ever tried again. Now a finished recording leaves a note beside
itself, `<file>.mp4.upload.json`, and the note stays until Mission Control has
the video or has said it never will. The watcher looks at the notes on every
pass, so a video goes the next time the satellite has a way out: a wired drop,
a hotspot, or the next boot.

Notes are written to a temporary file, flushed to the card and renamed over
the old one. Cutting the power straight after a git pull once left every file
the pull had touched empty (17 October 2026). An empty note cannot be read, so
it is dropped, and the rename means the only way to get one is to lose it
before it was ever complete.

Never logs the shared credential: errors are reported by type and HTTP status.
"""

import json
import os
import threading
import time

import requests

MAX_RECORDING_BYTES = 30 * 1024 * 1024
NOTE_SUFFIX = '.upload.json'

# A minute, then doubling, and never more than half an hour apart. Offline the
# request fails at once for want of a route, so retrying costs nothing, and a
# yard that finds a connection sends its videos within the half hour.
FIRST_RETRY_SECONDS = 60
MAX_RETRY_SECONDS = 30 * 60

# Mission Control's answers that settle a note.
DONE = {'uploaded', 'already-uploaded'}
# Not configured there, or YouTube refused it as many times as the ledger
# allows. The recording stays on the card for the manual upload.
GIVE_UP = {'not-configured', 'max-attempts'}

_delivering = threading.Lock()


def _secret():
    return os.environ.get('YOUTUBE_UPLOAD_INGEST_SECRET', '').strip()


def _endpoint():
    base = (os.environ.get('MISSION_CONTROL_URL') or 'https://marsyard.labs.ws').rstrip('/')
    return f'{base}/api/youtube-upload/recording'


def _recordings_dir():
    import recording_control
    return recording_control.RECORDINGS_DIR


def _write_note(path, note):
    temporary = path + '.tmp'
    with open(temporary, 'w') as handle:
        json.dump(note, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def _drop(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _backoff(attempts):
    return min(MAX_RETRY_SECONDS, FIRST_RETRY_SECONDS * 2 ** max(0, attempts - 1))


def queue_upload(mission_id, dispatch_id, yard_id, recording_path, outcome=None):
    """Note that this recording is to be delivered, and try straight away.

    `outcome` is what the rover reported for the run, completed or error. It
    travels with the video because Mission Control attaches an uploaded video
    to its run and closes the run with it, which must not happen to a run the
    rover could not execute: that one is the operator's to judge.
    """
    if not _secret():
        return 'not-configured'
    _write_note(recording_path + NOTE_SUFFIX, {
        'missionId': mission_id,
        'dispatchId': dispatch_id,
        'yardId': yard_id,
        'outcome': outcome,
        'attempts': 0,
        'nextTryAt': 0,
        'lastError': None,
    })
    kick()
    return 'queued'


def pending_notes():
    directory = _recordings_dir()
    try:
        names = os.listdir(directory)
    except OSError:
        return []
    return sorted(os.path.join(directory, name) for name in names
                  if name.endswith('.mp4' + NOTE_SUFFIX))


def _read_note(path):
    try:
        with open(path) as handle:
            note = json.load(handle)
    except (OSError, ValueError):
        return None
    return note if isinstance(note, dict) and note.get('missionId') and note.get('dispatchId') else None


def has_due(now=None):
    """Whether a delivery pass would have anything to do. Cheap: no network."""
    if not _secret():
        return False
    now = time.time() if now is None else now
    for path in pending_notes():
        note = _read_note(path)
        # An unreadable note is due too: the pass is what drops it.
        if note is None or note.get('nextTryAt', 0) <= now:
            return True
    return False


def _deliver_once(note, recording):
    """One request. ('done' | 'give-up' | 'retry', what happened)."""
    name = os.path.basename(recording)
    fields = {
        'missionId': note['missionId'],
        'runId': note['dispatchId'],
        'yardId': note.get('yardId') or '',
        'recordingName': name,
    }
    if note.get('outcome'):
        fields['outcome'] = note['outcome']
    headers = {'x-youtube-upload-secret': _secret()}

    try:
        too_large = os.path.getsize(recording) > MAX_RECORDING_BYTES
        if too_large:
            # Too big for Cloud Run's request limit. Mission Control is told,
            # so the operator sees why there is no automatic upload.
            response = requests.post(_endpoint(), headers=headers,
                                     data={**fields, 'failureCode': 'too-large'}, timeout=(5, 10))
        else:
            with open(recording, 'rb') as video:
                response = requests.post(_endpoint(), headers=headers, data=fields,
                                         files={'file': (name, video, 'video/mp4')},
                                         timeout=(5, 180))
    except (OSError, requests.exceptions.RequestException) as error:
        return 'retry', type(error).__name__

    if response.status_code >= 500 or response.status_code == 429:
        return 'retry', f'HTTP {response.status_code}'
    if not response.ok:
        # 401 is a credential the two ends do not share, 400 a request that
        # will never be valid. Sending ten megabytes again every half hour
        # over a phone's hotspot would not change either.
        return 'give-up', f'HTTP {response.status_code}'
    if too_large:
        return 'give-up', 'too-large'
    try:
        status = (response.json() or {}).get('status')
    except ValueError:
        return 'retry', 'unreadable reply'
    if status in DONE:
        return 'done', status
    if status in GIVE_UP:
        return 'give-up', status
    # in-progress: another attempt holds the upload; asking again later finds
    # out how it went.
    return 'retry', status or 'no status'


def deliver_due(now=None):
    """Try every note that is due, once each. [(recording, verdict, detail)]."""
    if not _secret():
        return []
    results = []
    for path in pending_notes():
        recording = path[:-len(NOTE_SUFFIX)]
        name = os.path.basename(recording)
        note = _read_note(path)
        if note is None:
            _drop(path)
            print(f'[youtube-upload] {name}: the delivery note could not be read; dropped.')
            results.append((name, 'give-up', 'unreadable note'))
            continue
        if not os.path.exists(recording):
            # Deleted on Settings or by the cleanup sweep. Nothing left to send.
            _drop(path)
            results.append((name, 'give-up', 'recording gone'))
            continue
        moment = time.time() if now is None else now
        if note.get('nextTryAt', 0) > moment:
            continue

        verdict, detail = _deliver_once(note, recording)
        if verdict == 'retry':
            note['attempts'] = int(note.get('attempts', 0)) + 1
            note['nextTryAt'] = moment + _backoff(note['attempts'])
            note['lastError'] = detail
            _write_note(path, note)
            if note['attempts'] == 1:
                print(f'[youtube-upload] {name}: not delivered yet ({detail}); will keep trying.')
        else:
            _drop(path)
            if verdict == 'give-up':
                print(f'[youtube-upload] {name}: not uploading automatically ({detail}); '
                      'the recording stays for the manual upload.')
        results.append((name, verdict, detail))
    return results


def kick():
    """Run a delivery pass on its own thread, unless one is already running.

    Its own thread because an upload can take minutes and the watcher that
    calls this is also the thing that stops recordings. One at a time because
    two passes would send the same note twice.
    """
    if not _delivering.acquire(blocking=False):
        return None

    def run():
        try:
            deliver_due()
        except Exception as error:
            print(f'[youtube-upload] Delivery pass failed: {type(error).__name__}.')
        finally:
            _delivering.release()

    thread = threading.Thread(target=run, name='youtube-recording-upload', daemon=True)
    thread.start()
    return thread
