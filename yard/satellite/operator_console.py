"""
Operator Console - Flask blueprint for the yard operator interface

Mounted on the satellite web server at /operator/. Operators sign in with
their Firebase email/password (the account needs an 'operator' or 'admin'
custom claim), see the mission queue from Firestore, and send a mission's
Python straight to the rover queue with one tap. Mark-complete and the
YouTube link close the loop so learners see their run on the public site.

The public mission-control web app has no operator surface at all; this
console is the only operator UI and it lives on the yard's local network.

Configuration (environment):
  FIREBASE_PROJECT_ID
      The project for Firestore + token verification (same variable name as
      mission-control's .env, so one env file can feed both). Credentials
      come from Application Default Credentials only:
      `gcloud auth application-default login`.
  FIREBASE_WEB_API_KEY (or NEXT_PUBLIC_FIREBASE_API_KEY)
      Web API key used for the email/password sign-in REST call.
  OPERATOR_SESSION_SECRET
      Optional. Stable Flask session secret; unset means sessions reset
      when the server restarts (operators just log in again).
  YOUTUBE_API_KEY / YOUTUBE_CHANNEL_ID
      Optional. Powers the background poll (start_polling/check_for_new_videos)
      that auto-links a completed mission to its YouTube upload by matching
      "MissionID: <id>" in the video description. Either unset disables the
      poll (it logs and no-ops) - manual "attach YouTube URL" still works
      without these.
  MISSION_CONTROL_URL
      Optional. Base URL of the mission-control web app, used to fire a
      best-effort POST /api/missions/<id>/notify after a status change so the
      learner gets a status email. This console remains fully functional
      (Firestore is still updated) if mission-control is unreachable or this
      is unset - the call is fire-and-forget. Defaults to
      http://localhost:3000.

This module is now a facade. The routes, auth, camera control, sync config,
the review flow and Firebase access live in the `console` package, one module
per concern; importing that package is what registers the routes on the
shared blueprint. What stays here is the surface web_server.py and the
templates already reach for, plus the YouTube poll wrappers that keep the
Firestore accessor in one place.

The package is named `console` and this file `operator_console` for the same
reason: neither may shadow Python's stdlib `operator` module.
"""

import youtube_poll
from console import (  # noqa: F401
    auth, camera, config, deps, health, mirror, missions, notify, review,
)
# Re-exported, not re-implemented: web_server.py and the templates reach the
# console through this module, and these are the names they use. The bodies
# live in the console package.
from console.auth import current_operator, require_operator  # noqa: F401

# operator_bp and the auth layer now live in the console package.
from console.blueprint import operator_bp

# The collection the YouTube poll writes links into.
MISSIONS_COLLECTION = 'missions'


# YouTube auto-linking lives in youtube_poll.py. These two wrappers stay so
# the console remains the one place that knows how to reach Firebase, and so
# the names web_server.py and the tests already use keep working.

def check_for_new_videos():
    """Run one YouTube poll, using this module's Firestore accessor."""
    return youtube_poll.check_for_new_videos(deps.firestore_client, MISSIONS_COLLECTION)


def start_polling():
    """Start the five-minute YouTube poll loop."""
    youtube_poll.poll_forever(check_for_new_videos)
