"""
What a YouTube URL means to this satellite.

All that is left of youtube_poll.py. The background poll that matched uploads
to missions moved to Mission Control (POST /api/cron/youtube-link), because it
could not work here: the operator downloads the video from this box and
uploads it from their own device later, by which time the satellite is off,
so the poll only ever caught up when the yard next ran an event. It also
needed internet on the one machine built to work without it, and kept a
YouTube API key on a Pi sitting on a venue's wifi.

The operator's manual attach stays, and this is the shape it accepts.
"""

import re

YOUTUBE_URL_PATTERNS = (
    re.compile(r'^https?://(www\.)?youtube\.com/watch\?v=[\w-]+'),
    re.compile(r'^https?://youtu\.be/[\w-]+'),
)
