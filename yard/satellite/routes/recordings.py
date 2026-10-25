"""
The camera's readiness and the recordings on this satellite: start, stop,
list, download, delete.
"""

import os
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, send_file

recordings_bp = Blueprint('recordings', __name__)


def recording_name(raw):
    """An operator-supplied name reduced to something safe to put in a path.

    The rule is recording_control.recording_key. It lives there because the
    watcher must reduce the mission id the rover reports in exactly the same
    way to find the recording again; see that function for what happened when
    the two sides disagreed.
    """
    from recording_control import recording_key
    return recording_key(raw)


@recordings_bp.route('/api/camera/ready', methods=['GET'])
def api_camera_ready():
    """Whether frames are actually arriving, not just whether the port is open.

    Now a thin view of the same snapshot /api/status serves, so the two cannot
    disagree. It stays because it is the honest name for the question and the
    run station's gate reads it, but it is no longer a second source of truth.
    """
    from camera_state import snapshot

    state = snapshot()
    return jsonify({'ready': state['ready'], 'detail': state['detail']})


@recordings_bp.route('/api/recording/start', methods=['POST'])
def api_recording_start():
    """Start recording a copy-paste run.

    /run/ is the only path that records: the operator names the run and this
    starts it before they press Send. Pasting straight into /code/ never
    records at all, so that manual flow produces no video: the operator runs
    the rover and there is nothing to take away and upload.

    The name is the operator's, not a mission id, because a pasted run has no
    mission. Whatever they type is what the file is called and what they will
    recognise later when matching it to a mission in Mission Control.
    """
    from recording_control import is_ready, start_recording
    from satellite_identity import yard_id

    data = request.get_json(silent=True) or {}
    name = recording_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Give the recording a name'}), 400

    # Without this, the manual loop was the one path that would happily
    # report 'recording' with no frames arriving, and the operator found out
    # at the end of the night when there was no file to upload. A camera that
    # is merely listening is not a camera that is recording.
    ready, detail = is_ready()
    if not ready:
        return jsonify({
            'error': f'Camera is not ready ({detail}). Fix the camera feed before '
                     'you run - a run with no video cannot be handed over later.',
        }), 503

    ok, detail = start_recording(name, yard_id())
    if not ok:
        return jsonify({'error': detail}), 503
    # `name` is the key the caller stops with; `file` is what the run actually
    # wrote, which now carries a per-run timestamp so a re-run cannot land on
    # the previous attempt's video. The operator needs the second one to find
    # the file, so it is returned rather than left to be guessed.
    return jsonify({'status': 'recording', 'name': name,
                    'file': os.path.basename(detail)})


@recordings_bp.route('/api/recording/stop', methods=['POST'])
def api_recording_stop():
    """Stop a copy-paste run's recording, keeping the file unless told not to."""
    from recording_control import stop_recording
    from satellite_identity import yard_id

    data = request.get_json(silent=True) or {}
    name = recording_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Give the recording a name'}), 400

    keep = data.get('keep', True)
    ok, detail = stop_recording(name, yard_id(), keep=bool(keep))
    return jsonify({'status': 'stopped', 'kept': bool(keep), 'detail': detail}), (200 if ok else 200)


@recordings_bp.route('/api/recordings', methods=['GET'])
def api_recordings():
    """The videos sitting on this satellite, newest first.

    Step five of the manual loop: the operator takes the file to their own
    device, uploads it to YouTube and pastes the link into Mission Control.
    Until this existed the recordings were written and then unreachable, so
    the loop could not be closed by hand at all.

    Deliberately unauthenticated, like /code/ and /monitor/. The whole point
    is that this works when the venue wifi cannot reach Firebase, and an
    operator who can already drive the rover from this network gains nothing
    by being able to read a video of it.
    """
    from recording_control import RECORDINGS_DIR
    from recording_cleanup import is_downloaded, disk_stats

    try:
        names = os.listdir(RECORDINGS_DIR)
    except OSError:
        return jsonify({'recordings': [], 'disk': disk_stats()})

    files = []
    for name in names:
        if not name.endswith('.mp4'):
            continue
        path = os.path.join(RECORDINGS_DIR, name)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        dl, dl_at = is_downloaded(path)
        from youtube_upload import state_of as upload_state
        files.append({
            'name': name,
            'bytes': stat.st_size,
            'modified': datetime.fromtimestamp(stat.st_mtime, timezone.utc)
                .isoformat().replace('+00:00', 'Z'),
            'downloaded': dl,
            'downloadedAt': dl_at.isoformat().replace('+00:00', 'Z') if dl_at else None,
            'upload': upload_state(path),
        })

    files.sort(key=lambda f: f['modified'], reverse=True)
    return jsonify({'recordings': files, 'disk': disk_stats()})


@recordings_bp.route('/api/recordings/<path:name>', methods=['GET'])
def api_recording_download(name):
    """Download one recording.

    The name is resolved and then checked to be inside the recordings
    directory, rather than trusted or merely sanitised: this is a path taken
    straight from a URL on a network the satellite does not control, and
    ../../ is the oldest trick there is.
    """
    from recording_control import RECORDINGS_DIR

    root = os.path.realpath(RECORDINGS_DIR)
    target = os.path.realpath(os.path.join(root, name))
    if os.path.commonpath([root, target]) != root or not target.endswith('.mp4'):
        return jsonify({'error': 'No such recording'}), 404
    if not os.path.isfile(target):
        return jsonify({'error': 'No such recording'}), 404

    from recording_cleanup import mark_downloaded
    mark_downloaded(target)

    return send_file(target, mimetype='video/mp4', as_attachment=True,
                     download_name=os.path.basename(target))


@recordings_bp.route('/api/recordings/delete', methods=['POST'])
def api_recordings_delete():
    """Delete one or more recordings from the SD card.

    Accepts {"names": ["file1.mp4", "file2.mp4"]}. Each name gets the same
    path-traversal and active-recording checks the download endpoint applies.
    Returns which files were deleted and which were skipped, so the UI can
    report partial success rather than all-or-nothing.
    """
    from recording_control import RECORDINGS_DIR, active_paths
    from recording_cleanup import delete_recording

    data = request.get_json(silent=True) or {}
    names = data.get('names')
    if not names or not isinstance(names, list):
        return jsonify({'error': 'Provide a list of recording names'}), 400

    root = os.path.realpath(RECORDINGS_DIR)
    protected = active_paths()
    deleted = []
    skipped = []

    for name in names:
        if not isinstance(name, str):
            skipped.append({'name': str(name), 'reason': 'invalid name'})
            continue
        target = os.path.realpath(os.path.join(root, name))
        if os.path.commonpath([root, target]) != root or not target.endswith('.mp4'):
            skipped.append({'name': name, 'reason': 'not found'})
            continue
        if not os.path.isfile(target):
            skipped.append({'name': name, 'reason': 'not found'})
            continue
        if target in protected:
            skipped.append({'name': name, 'reason': 'currently recording'})
            continue
        if delete_recording(target, 'operator'):
            deleted.append(name)
        else:
            skipped.append({'name': name, 'reason': 'delete failed'})

    return jsonify({'deleted': deleted, 'skipped': skipped})
