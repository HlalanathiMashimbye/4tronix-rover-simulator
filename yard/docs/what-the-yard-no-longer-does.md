# What the yard no longer does, and how to give it back

The satellite mirrored Firestore. It pulled the mission queue down, held a
local copy in SQLite, served an operator console off that copy, pushed status
changes back through an outbox, and reconciled the two on a timer. That is all
gone. This file exists so the next person to want it does not have to work out
what "it" was.

## Why it went

The yard runs the manual loop: an operator copies a mission's Python out of
Mission Control, pastes it into `/run/`, presses Send, and the station records
the run and hands them the file. Nothing in that path needs Firestore. The
mirror was carrying the cost of a feature the yard had stopped using -
credentials on the box, a background thread, a daily read quota, and about
4,300 lines including a whole second operator console that was no longer even
linked from the nav.

## What is still true, and is what automation would build on

Removing the mirror did not remove the seams. These are deliberate:

- **The dispatch carries `mission_id`.** `/run/` puts it in the rover
  instruction's params, and the rover echoes it back on its history entry.
- **The rover reports completion.** `GET /queue/status` on the rover returns a
  history with `status` and those params, and `mission_watcher` reads it.
- **Recordings are keyed `(mission_id, yard_id)`** and filed as
  `<mission>__<yard>.mp4`, which is the same shape Mission Control's YouTube
  linker parses out of an uploaded title.
- **The yard knows its own id.** `satellite_identity.yard_id()`.
- **Settings can be changed at runtime** through `tunables`, without a restart.

So the satellite already produces everything an automated path would need to
report: which mission ran, at which yard, whether the rover finished it, and
where the video is.

## What coming back online would mean

Not "restore the deleted files". The thing that was deleted was two-way
Firestore replication with an offline mirror, conflict reconciliation and a
lease per run - a large amount of machinery for a box that also has to work
with no network at all. If the yard needs to talk to Mission Control again,
the cheaper shape is almost certainly:

- **outbound only, over HTTP, to Mission Control** rather than to Firestore
  directly. The satellite has no business holding Firebase credentials.
- **best effort, with a queue on disk** for the offline case. The old outbox is
  worth reading for its parking and back-off behaviour.
- **no local mirror.** The reason the mirror existed was to let the yard's own
  operator console work offline. That console is gone; Mission Control is the
  operator surface now.

Everything named here is in the git history. The removal is one commit, so
`git log --diff-filter=D` against it lists every file, and any of them can be
read at the commit before it.
