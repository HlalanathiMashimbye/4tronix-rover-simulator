/**
 * What an operator may do to a run from a desk, with no rover involved.
 *
 * Pasting a YouTube URL and marking a mission complete are desk jobs. Only
 * physical actions have to happen at the yard, and the whole point of moving
 * these five off the satellite is that they must not depend on the yard having
 * network. An operator sitting anywhere with a browser can settle the record.
 *
 * NOTHING HERE MOVES A ROVER, AND THAT IS LOAD-BEARING RATHER THAN INCIDENTAL.
 * There is no dispatch, no stop, no camera. Stop in particular stays on the
 * satellite permanently: a cloud stop button would take up to a sync interval
 * and do nothing at all when offline, which is a lie told by the one control
 * whose entire justification is immediacy.
 *
 * The preconditions below are copied from the Flask console deliberately, so
 * the two surfaces cannot disagree about what state a mission is in while both
 * exist. Kept as pure functions on purpose: this is the part worth testing, and
 * it tests without Firestore, without a session and without a network.
 */

import type { MissionStatus } from '../entities/Mission';

export type ResolveOutcome = 'completed' | 'requeue';

/**
 * Statuses an operator may still act on. A mission that already settled is not
 * work waiting for anyone, and re-completing it would move timestamps around
 * for no reason.
 */
const OPEN_STATUSES: readonly MissionStatus[] = ['queued', 'processing'];

export interface RunSnapshot {
  /**
   * The run at the operator's chosen yard, or null when there is no run
   * document at all.
   *
   * NULL IS THE ORDINARY CASE, NOT AN ERROR. A yard with no network never
   * flushes its run outbox, so a mission an operator ran by hand this afternoon
   * may exist only in the satellite's SQLite mirror. The desk still has to be
   * able to record the outcome, so a missing run falls back to the mission's
   * own status and the write creates the run rather than refusing.
   */
  runStatus: MissionStatus | null;
  /** The mission roll-up, which is what the operator queue actually renders. */
  missionStatus: MissionStatus;
  needsReview: boolean;
}

export interface StatusChange {
  /** The new run status, or null to leave it alone (attaching a video). */
  status: MissionStatus | null;
  clearsReview: boolean;
}

export type Decision =
  | { ok: true; change: StatusChange }
  | { ok: false; error: string };

/**
 * The status an operator is really acting on.
 *
 * The run wins when it exists, because it is the record of an actual attempt.
 * The mission is the fallback for the offline-yard case above.
 */
export function effectiveStatus(snapshot: RunSnapshot): MissionStatus {
  return snapshot.runStatus ?? snapshot.missionStatus;
}

function isOpen(snapshot: RunSnapshot): boolean {
  return OPEN_STATUSES.includes(effectiveStatus(snapshot));
}

/** The operator checked, and the run finished. */
export function decideComplete(snapshot: RunSnapshot): Decision {
  if (!isOpen(snapshot)) {
    return {
      ok: false,
      error: `This mission is already ${effectiveStatus(snapshot)}, so there is nothing to complete.`,
    };
  }
  // Completing also settles a review: the operator has just said what happened,
  // which is the only question the flag was asking.
  return { ok: true, change: { status: 'completed', clearsReview: true } };
}

/**
 * Take a mission out of the queue without running it here.
 *
 * Cancel rather than delete, deliberately. The mission is a child's work and
 * the record of it should survive. 'cancelled' also reads as Pending on the
 * learner's side rather than as a rejection, so nobody is told their mission
 * was thrown away.
 *
 * ALLOWED ON A RUNNING MISSION, which looks wrong until you consider the case
 * it exists for. A run stuck in 'processing' because the yard lost signal
 * mid-mission is precisely what needs clearing from a desk, and refusing it
 * here would leave that mission unresolvable from anywhere. Cancelling records
 * an outcome; it does not reach the rover, and the console says so where the
 * operator can read it.
 */
export function decideCancel(snapshot: RunSnapshot): Decision {
  if (!isOpen(snapshot)) {
    return {
      ok: false,
      error: `This mission is already ${effectiveStatus(snapshot)}, so there is nothing to cancel.`,
    };
  }
  return { ok: true, change: { status: 'cancelled', clearsReview: true } };
}

/**
 * Attach the video of a finished run.
 *
 * Completed only, matching the order the work actually happens in: the operator
 * marks the mission complete, downloads the recording from the satellite,
 * uploads it, and comes back with a link. A video on an unfinished run would
 * also be a video the learner could watch for a mission still showing as
 * Pending.
 */
export function decideAttachVideo(snapshot: RunSnapshot): Decision {
  if (effectiveStatus(snapshot) !== 'completed') {
    return {
      ok: false,
      error: 'Mark the mission complete before attaching its video.',
    };
  }
  // Status untouched: the run is already completed and attaching a link is not
  // a state change.
  return { ok: true, change: { status: null, clearsReview: false } };
}

/**
 * Record what happened to a mission the satellite could not account for.
 *
 * The endpoint behind this has existed since recovery shipped and has never had
 * a way to reach it, so flags raised by a satellite that lost power have only
 * ever been clearable by a script.
 *
 * 'requeue' puts the mission back in the queue for a human to send again. It
 * deliberately does NOT dispatch: nothing here moves a rover, including this.
 */
export function decideResolve(snapshot: RunSnapshot, outcome: ResolveOutcome): Decision {
  if (!snapshot.needsReview) {
    return { ok: false, error: 'This mission is not waiting on a review.' };
  }
  return {
    ok: true,
    change: {
      status: outcome === 'completed' ? 'completed' : 'queued',
      clearsReview: true,
    },
  };
}
