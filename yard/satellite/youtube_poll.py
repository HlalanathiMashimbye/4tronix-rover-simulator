"""
Auto-linking completed missions to their YouTube uploads.

Split out of operator_console.py, which was 1399 lines carrying seven
unrelated jobs. This one is not a web concern at all: it is a background
timer loop that talks to the YouTube Data API and writes a link back, and it
had no reason to live inside a Flask blueprint beyond having been written
there. Shaped after camera_control.py, which is the satellite module that
already got this right.

The Firestore accessor is passed in rather than imported. That keeps the
dependency pointing one way (operator_console -> youtube_poll, never back),
which is what makes this file testable on its own, and it means the console
stays the single place that decides how to reach Firebase.
"""

import os
import re
import threading
from typing import Callable

import requests

from ports import FirestoreClient


# Accepted shapes for a manually attached link. Lives here rather than in the
# console because this module owns what a YouTube URL means; the console's
# attach route imports it.
YOUTUBE_URL_PATTERNS = (
    re.compile(r'^https?://(www\.)?youtube\.com/watch\?v=[\w-]+'),
    re.compile(r'^https?://youtu\.be/[\w-]+'),
)

POLL_INTERVAL_SECONDS = 300


def api_key():
    return os.environ.get('YOUTUBE_API_KEY')


def channel_id():
    return os.environ.get('YOUTUBE_CHANNEL_ID')


def check_for_new_videos(firestore: Callable[[], FirestoreClient],
                         missions_collection: str = 'missions') -> None:
    """Poll the YouTube channel for uploads matching a completed mission's ID.

    Candidates come from the local mirror, not Firestore. The previous version
    streamed every completed mission out of Firestore on each pass: at one read
    per completed mission every five minutes, that was ~21,000 reads/day on
    this yard and rising with every child who finished a run - roughly 80% of
    the satellite's entire Firestore bill, for a list the mirror already had.

    (The old approach could not narrow that query either: a mission has no
    `youtubeUrl` field at all until one is attached, and Firestore's `== None`
    matches documents where the field is present and null, not absent. SQL has
    no such trouble.)

    Firestore is now touched only to WRITE a link that was actually found, so a
    quiet poll - which is nearly all of them - costs nothing at all.

    Args:
        firestore: zero-arg callable returning a Firestore client. Called only
            when a match is found, for the reason in the comment below.
        missions_collection: name of the missions collection.
    """
    print('[youtube-poll] Checking for new videos...')

    key = api_key()
    channel = channel_id()
    if not key or not channel:
        print('[youtube-poll] Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID; skipping poll')
        return

    from mission_store import completed_without_video
    from satellite_identity import yard_id

    unlinked_ids = completed_without_video(yard_id=yard_id())
    if not unlinked_ids:
        # Nothing to look for, so do not spend a YouTube API call either.
        return

    # The uploads playlist id is the channel id with UC -> UU.
    uploads_playlist = channel.replace('UC', 'UU', 1)

    try:
        response = requests.get(
            'https://www.googleapis.com/youtube/v3/playlistItems',
            params={
                'part': 'snippet',
                'playlistId': uploads_playlist,
                'maxResults': 50,
                'key': key,
            },
            timeout=10.0,
        )
    except requests.exceptions.RequestException as e:
        print(f'[youtube-poll] Could not reach the YouTube API: {e}')
        return

    if response.status_code != 200:
        print(f'[youtube-poll] YouTube API error: HTTP {response.status_code}')
        return

    videos = response.json().get('items', [])

    # Built on the first actual match, not up front: constructing the client is
    # the only thing here that can fail when the yard is offline, and a poll
    # that matches nothing should not be able to log an error about Firestore.
    missions_ref = None

    # Match mission ids embedded in video descriptions.
    for mission_id in unlinked_ids:
        for video in videos:
            description = video.get('snippet', {}).get('description', '')

            if f'MissionID: {mission_id}' in description:
                video_id = video.get('snippet', {}).get('resourceId', {}).get('videoId')
                if not video_id:
                    continue
                youtube_url = f'https://www.youtube.com/watch?v={video_id}'

                # Plan 7.5: this poll writes to Firestore directly rather than
                # through the outbox (it only runs online anyway, since it needs
                # the YouTube API). Skip any mission with a pending local write,
                # or this would land between the flush's read and write and be
                # clobbered - or clobber it.
                if _has_pending_writes(mission_id):
                    print(f'[youtube-poll] Skipping {mission_id}: local writes pending')
                    break

                try:
                    if missions_ref is None:
                        missions_ref = firestore().collection(missions_collection)
                    missions_ref.document(mission_id).update({'youtubeUrl': youtube_url})
                except Exception as e:
                    # Leave the mirror alone so this mission is still a
                    # candidate next pass; the link is not lost, just not
                    # written yet.
                    print(f'[youtube-poll] Could not link {mission_id}: {e}')
                    break

                _mirror_youtube_url(mission_id, youtube_url)
                print(f'[youtube-poll] Linked mission {mission_id} to video {video_id}')
                break


def _has_pending_writes(mission_id):
    """True if the outbox still holds an unflushed change for this mission."""
    try:
        from mission_store import mission_has_pending
        return mission_has_pending(mission_id)
    except Exception:
        # If we cannot tell, assume there are: skipping one poll cycle is
        # cheaper than racing a flush.
        return True


def _mirror_youtube_url(mission_id, url):
    """Keep the mirror in step with a direct Firestore write, so the console
    shows the link without waiting for the next pull."""
    try:
        from mission_store import set_mirror_only
        set_mirror_only(mission_id, {'youtube_url': url})
    except Exception:
        pass


def poll_forever(check, interval=POLL_INTERVAL_SECONDS):
    """Run `check` now, then again every `interval` seconds, forever.

    A bad poll (Firestore hiccup, YouTube API down, anything unexpected)
    must never stop the loop - the reschedule always has to run, or the
    feature silently dies until the satellite is restarted.

    `check` is passed in rather than called directly so the caller decides
    what a poll does; operator_console hands it a closure carrying the
    Firestore accessor.
    """
    try:
        check()
    except Exception as e:
        print(f'[youtube-poll] Unexpected error during poll: {e}')

    timer = threading.Timer(interval, lambda: poll_forever(check, interval))
    timer.daemon = True
    timer.start()
