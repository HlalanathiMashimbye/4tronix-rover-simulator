"""Best-effort delivery of closed recordings to Mission Control."""

import os
import threading
import time

import requests

MAX_RECORDING_BYTES = 30 * 1024 * 1024
MAX_DELIVERY_ATTEMPTS = 3


def upload_recording(mission_id, dispatch_id, yard_id, recording_path):
    """Send a closed recording to the server; never expose credentials in logs."""
    secret = os.environ.get('YOUTUBE_UPLOAD_INGEST_SECRET', '').strip()
    if not secret:
        return 'not-configured'
    if os.path.getsize(recording_path) > MAX_RECORDING_BYTES:
        base_url = (os.environ.get('MISSION_CONTROL_URL') or 'https://marsyard.labs.ws').rstrip('/')
        try:
            response = requests.post(
                f'{base_url}/api/youtube-upload/recording',
                headers={'x-youtube-upload-secret': secret},
                data={
                    'missionId': mission_id,
                    'runId': dispatch_id,
                    'yardId': yard_id,
                    'recordingName': os.path.basename(recording_path),
                    'failureCode': 'too-large',
                },
                timeout=(5, 10),
            )
            if not response.ok:
                print(f'[youtube-upload] Could not record the size-limit status (HTTP {response.status_code}).')
        except requests.exceptions.RequestException as error:
            print(f'[youtube-upload] Could not record the size-limit status ({type(error).__name__}).')
        print('[youtube-upload] Recording exceeds the automatic-upload size limit; use manual upload.')
        return 'too-large'

    base_url = (os.environ.get('MISSION_CONTROL_URL') or 'https://marsyard.labs.ws').rstrip('/')
    url = f'{base_url}/api/youtube-upload/recording'
    recording_name = os.path.basename(recording_path)

    for attempt in range(MAX_DELIVERY_ATTEMPTS):
        try:
            with open(recording_path, 'rb') as video:
                response = requests.post(
                    url,
                    headers={'x-youtube-upload-secret': secret},
                    data={
                        'missionId': mission_id,
                        'runId': dispatch_id,
                        'yardId': yard_id,
                        'recordingName': recording_name,
                    },
                    files={'file': (recording_name, video, 'video/mp4')},
                    timeout=(5, 180),
                )
            if response.ok:
                result = response.json()
                status = result.get('status')
                if status in ('uploaded', 'in-progress', 'already-uploaded', 'not-configured', 'max-attempts'):
                    return status
                if result.get('status') == 'failed' and attempt + 1 < MAX_DELIVERY_ATTEMPTS:
                    time.sleep(attempt + 1)
                    continue
                print(f'[youtube-upload] Mission {mission_id}, dispatch {dispatch_id}: upload failed.')
                return 'failed'
            if response.status_code < 500 or attempt + 1 == MAX_DELIVERY_ATTEMPTS:
                print(f'[youtube-upload] Mission {mission_id}, dispatch {dispatch_id}: HTTP {response.status_code}.')
                return 'failed'
        except (OSError, requests.exceptions.RequestException, ValueError) as error:
            if attempt + 1 == MAX_DELIVERY_ATTEMPTS:
                print(f'[youtube-upload] Mission {mission_id}, dispatch {dispatch_id}: delivery failed ({type(error).__name__}).')
                return 'failed'
        time.sleep(attempt + 1)

    return 'failed'


def start_recording_upload(mission_id, dispatch_id, yard_id, recording_path):
    """Run delivery away from the rover-history watcher thread."""
    thread = threading.Thread(
        target=upload_recording,
        args=(mission_id, dispatch_id, yard_id, recording_path),
        name='youtube-recording-upload',
        daemon=True,
    )
    thread.start()
    return thread
