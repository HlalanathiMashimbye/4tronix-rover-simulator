"""
Reading the local SQLite mirror, and the shape the API returns it in.

The console serves the mirror, not Firestore: that is what lets it keep
working with no internet. These helpers are the seam between the two - the
row mapper holds the frontend contract (home.html's queue, mission.html),
which predates the mirror and is unchanged by it.

now_iso lives here because it is the timestamp format written into the
mirror, and both the mission routes and the review routes stamp times with
it.
"""

from datetime import datetime, timezone

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
def mirror_row_to_dict(row):
    """Map a mission_mirror SQLite row (snake_case) to the API's camelCase
    shape - the frontend contract (home.html's queue, mission.html) predates
    the mirror and is unchanged by it.
    """
    return {
        'id': row['id'],
        'name': row.get('name'),
        'yardId': row.get('yard_id'),
        'code': row.get('code') or '',
        'blocklyState': row.get('blockly_state'),
        'status': row.get('status'),
        'submittedAt': row.get('submitted_at'),
        'startedAt': row.get('started_at'),
        'completedAt': row.get('completed_at'),
        'youtubeUrl': row.get('youtube_url'),
        'deleted': bool(row.get('deleted')),
        # Recovery flags. The home page already surfaces a needs-review banner
        # linking to each flagged mission, but the mission page could not see
        # the flag because it was not in this contract - so the banner led the
        # operator to a page offering nothing, which is worse than no banner.
        # The resolve endpoint has existed all along with no way to reach it.
        'needsReview': bool(row.get('needs_review')),
        'reviewReason': row.get('review_reason'),
        # BACKLOG 335/336/338. recording_path/timestamps stay run-internal -
        # a filesystem path on the satellite isn't operator-facing information.
        'recordingStatus': row.get('recording_status') or 'none',
    }


def mirror_is_stale(last_synced_at):
    """Stale if we've never synced, or the last pull was over 60s ago."""
    if not last_synced_at:
        return True
    synced_time = datetime.fromisoformat(last_synced_at.replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - synced_time).total_seconds()
    return age > 60
