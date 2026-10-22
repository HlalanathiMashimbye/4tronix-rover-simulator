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

A NOTE OUTLIVES ITS DELIVERY. Once Mission Control has the video, or has said
it never will, the note stays with what happened (`uploaded` and the link, or
`manual` and why), so the Settings page can show each video's state and the
day's tally without asking anyone.

Never logs the shared credential: errors are reported by type and HTTP status.
"""

import io
import json
import os
import threading
import time
import uuid

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

# How often to ask whether Mission Control answers, while something waits.
# Plugging the cable in then starts the uploads within a minute, rather than
# at the end of whatever back-off the last failure set.
PROBE_EVERY_SECONDS = 60

_delivering = threading.Lock()
# What the last request out found: None until one has been tried.
_connection = {'online': None, 'checkedAt': 0.0}
# The video going out right now, for the page: in memory only, because a note
# written on every read would wear the card, and a send that is cut off is
# simply waiting again.
_sending = {}
# This process started at boot, near enough, so "since then" is the day.
_STARTED = time.time()


def _secret():
    return os.environ.get('YOUTUBE_UPLOAD_INGEST_SECRET', '').strip()


def _endpoint():
    import tunables
    return f"{tunables.get('missionControlUrl')}/api/youtube-upload/recording"


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


def _state(note):
    return note.get('state') or 'waiting'


def _saw(online, now=None):
    """Record what a request out found, and when it is back, wake what waits."""
    was = _connection['online']
    _connection['online'] = online
    _connection['checkedAt'] = time.time() if now is None else now
    if online and was is False:
        for path in pending_notes():
            note = _read_note(path)
            if note and _state(note) == 'waiting' and note.get('nextTryAt', 0) > 0:
                note['nextTryAt'] = 0
                _write_note(path, note)


class _Upload:
    """The request body, read off the card as it is sent.

    Handed `files=`, requests builds the whole multipart body in memory
    before sending a byte: a 30 MB video in a Pi's memory, and progress that
    jumps from nothing to done. This is the same body, built on the way out,
    so every read is a measure of how far the send has got.
    """

    def __init__(self, fields, name, path, on_read):
        boundary = uuid.uuid4().hex
        head = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
                       for key, value in fields.items())
        head += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                 'Content-Type: video/mp4\r\n\r\n')
        tail = f'\r\n--{boundary}--\r\n'.encode()
        head = head.encode()
        self.content_type = f'multipart/form-data; boundary={boundary}'
        self._length = len(head) + os.path.getsize(path) + len(tail)
        self._parts = [io.BytesIO(head), open(path, 'rb'), io.BytesIO(tail)]
        self._sent = 0
        self._on_read = on_read

    def __len__(self):
        return self._length

    def read(self, size=-1):
        out = b''
        while self._parts and (size is None or size < 0 or len(out) < size):
            want = -1 if size is None or size < 0 else size - len(out)
            chunk = self._parts[0].read(want)
            if not chunk:
                self._parts.pop(0).close()
                continue
            out += chunk
        self._sent += len(out)
        self._on_read(self._sent, self._length)
        return out

    def close(self):
        for part in self._parts:
            part.close()
        self._parts = []


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
        'state': 'waiting',
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
        if note is None or (_state(note) == 'waiting' and note.get('nextTryAt', 0) <= now):
            return True
    return False


def _waiting_count():
    return sum(1 for path in pending_notes()
               if (note := _read_note(path)) and _state(note) == 'waiting')


def check_connection(now=None):
    """Whether Mission Control answers at all. Any reply is a yes."""
    import tunables
    try:
        requests.head(tunables.get('missionControlUrl'), timeout=(3, 3), allow_redirects=False)
    except requests.exceptions.RequestException:
        _saw(False, now)
        return False
    _saw(True, now)
    return True


def tick(now=None):
    """One watcher pass: ask after the connection while something waits, then
    send what is due."""
    if not _secret():
        return
    now = time.time() if now is None else now
    if _waiting_count() and now - _connection['checkedAt'] >= PROBE_EVERY_SECONDS:
        check_connection(now)
    if has_due(now):
        kick()


def _deliver_once(note, recording):
    """One request. ('done' | 'give-up' | 'retry', what happened, the video's link)."""
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

    body = None
    try:
        too_large = os.path.getsize(recording) > MAX_RECORDING_BYTES
        if too_large:
            # Too big for Cloud Run's request limit. Mission Control is told,
            # so the operator sees why there is no automatic upload.
            response = requests.post(_endpoint(), headers=headers,
                                     data={**fields, 'failureCode': 'too-large'}, timeout=(5, 10))
        else:
            def progress(sent, total):
                _sending.update(recording=name, sent=sent, total=total)

            body = _Upload(fields, name, recording, progress)
            response = requests.post(_endpoint(), headers={**headers, 'Content-Type': body.content_type},
                                     data=body, timeout=(5, 180))
    except (OSError, requests.exceptions.RequestException) as error:
        _saw(False)
        return 'retry', type(error).__name__, None
    finally:
        if body is not None:
            body.close()
        _sending.clear()

    _saw(True)
    if response.status_code >= 500 or response.status_code == 429:
        return 'retry', f'HTTP {response.status_code}', None
    if not response.ok:
        # 401 is a credential the two ends do not share, 400 a request that
        # will never be valid. Sending ten megabytes again every half hour
        # over a phone's hotspot would not change either.
        return 'give-up', f'HTTP {response.status_code}', None
    if too_large:
        return 'give-up', 'too-large', None
    try:
        reply = response.json() or {}
    except ValueError:
        return 'retry', 'unreadable reply', None
    status = reply.get('status')
    if status in DONE:
        # A fresh upload carries its link; one already uploaded carries it in
        # its ledger entry.
        return 'done', status, reply.get('url') or (reply.get('entry') or {}).get('url')
    if status in GIVE_UP:
        return 'give-up', status, None
    # in-progress: another attempt holds the upload; asking again later finds
    # out how it went.
    return 'retry', status or 'no status', None


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
        if _state(note) != 'waiting' or note.get('nextTryAt', 0) > moment:
            continue

        verdict, detail, url = _deliver_once(note, recording)
        if verdict == 'retry':
            note['attempts'] = int(note.get('attempts', 0)) + 1
            note['nextTryAt'] = moment + _backoff(note['attempts'])
            note['lastError'] = detail
            if note['attempts'] == 1:
                print(f'[youtube-upload] {name}: not delivered yet ({detail}); will keep trying.')
        elif verdict == 'done':
            note.update(state='uploaded', url=url, settledAt=moment, lastError=None)
        else:
            note.update(state='manual', reason=detail, settledAt=moment)
            print(f'[youtube-upload] {name}: not uploading automatically ({detail}); '
                  'the recording stays for the manual upload.')
        _write_note(path, note)
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


def state_of(recording_path):
    """What the Settings page shows for one recording, or None if it has no note."""
    note = _read_note(recording_path + NOTE_SUFFIX)
    if note is None:
        return None
    view = {key: note.get(key) for key in ('url', 'reason', 'attempts', 'nextTryAt', 'lastError', 'settledAt')}
    view['state'] = _state(note)
    if _sending.get('recording') == os.path.basename(recording_path) and _sending.get('total'):
        view['state'] = 'sending'
        view['percent'] = round(100 * _sending['sent'] / _sending['total'])
    return view


def summary():
    """For the console's top bar, on every page: what waits, what is going out,
    and what has settled since the satellite was switched on."""
    counts = {'waiting': 0, 'uploaded': 0, 'manual': 0}
    for path in pending_notes():
        note = _read_note(path)
        if not note:
            continue
        state = _state(note)
        if state == 'waiting' or note.get('settledAt', 0) >= _STARTED:
            counts[state] = counts.get(state, 0) + 1
    sending = dict(_sending) if _sending.get('total') else None
    return {
        'configured': bool(_secret()),
        'online': _connection['online'],
        'sending': sending,
        **counts,
    }
