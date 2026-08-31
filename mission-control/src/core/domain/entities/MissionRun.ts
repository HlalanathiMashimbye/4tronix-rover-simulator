/**
 * One yard's attempt at a mission.
 *
 * A mission is a PROGRAM a learner wrote. A run is one attempt to execute it on
 * a particular yard's rover. The two are separate because any yard may run any
 * mission, including two yards at the same time, and each attempt has its own
 * outcome: its own status, its own timestamps, its own video.
 *
 * Stored at `missions/{missionId}/runs/{yardId}`.
 *
 * KEYED BY YARD, not by attempt. One current run per yard; re-running there
 * replaces it. That is the simple version, chosen deliberately: keying by a
 * generated runId would preserve every attempt but means the learner's yard
 * selector has to handle the same yard appearing several times. Extendable
 * later without moving the data, because yardId stays a field on the document.
 *
 * A SUBCOLLECTION, never an array on the mission. Two yards updating one array
 * field concurrently is a lost-update bug: whichever write lands second wins
 * and silently discards the other. Separate documents mean each yard only ever
 * writes its own.
 *
 * WHY THIS MATTERS BEYOND TIDINESS. It is what makes a recording unambiguous.
 * A video keyed to a mission alone collides the moment two yards run the same
 * program: one mission, two recordings, one youtubeUrl field. It also removes
 * the reason the sync merge ladder exists, because two yards can no longer
 * disagree about one document.
 */

import type { MissionStatus } from './Mission';

export interface MissionRun {
  /** Which yard ran it. Also the document id. */
  yardId: string;

  status: MissionStatus;

  /** Set when the yard claimed the mission and dispatched it to its rover. */
  startedAt?: string;
  /** Set only when the rover's own history confirmed the run finished. */
  completedAt?: string;

  /**
   * The recording of THIS attempt. A run without one either has not finished
   * or produced nothing worth showing, and in both cases the learner's yard
   * selector leaves it out.
   */
  youtubeUrl?: string;

  /**
   * The satellite could not establish what happened - it lost power mid-run,
   * or the rover reported an error - so an operator has to decide. Never
   * inferred, and never shown to a learner as a failure.
   */
  needsReview?: boolean;
  reviewReason?: string | null;

  /** Used by the sync merge to break ties within a single yard's own history. */
  statusUpdatedAt?: string | null;

  /**
   * An operator's note to the learner about this run: "Good job!", or "the
   * turn was too small, try 90 degrees for a square".
   *
   * Free text on a world-readable document, which mission names deliberately
   * are not (AB#402). The difference is the author: an operator is an
   * authenticated adult holding a role claim, not an anonymous child, and the
   * text is length-capped and attributed at the API boundary. See
   * docs/THREAT-MODEL.md.
   */
  feedback?: string;
  /** Who wrote it, shown to the learner so the note has a person behind it. */
  feedbackBy?: string;
  feedbackAt?: string;
}

/** A run a learner can actually watch. */
export function hasVideo(run: MissionRun): boolean {
  return typeof run.youtubeUrl === 'string' && run.youtubeUrl.length > 0;
}

/**
 * Yards whose attempt produced something to watch, newest first.
 *
 * This is what populates the learner's yard selector. A failed run simply is
 * not in the list, which is also how the rule that a learner never sees
 * "Failed" survives the move to per-yard runs.
 */
export function watchableRuns(runs: MissionRun[]): MissionRun[] {
  return runs
    .filter(hasVideo)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

/**
 * Whether any yard finished this mission.
 *
 * The learner-facing status is a roll-up of the runs rather than a field:
 * "somebody ran this and it worked" is the only distinction a learner needs,
 * and it stays true however many yards attempted it.
 */
export function isCompletedAnywhere(runs: MissionRun[]): boolean {
  return runs.some((r) => r.status === 'completed');
}

/**
 * Whether this yard already has an attempt in flight.
 *
 * The whole duplicate-dispatch guard, and the reason no lock is needed: two
 * yards running the same mission is a feature, and within one yard this is
 * just reading state we already hold. The rover serialises the physical side
 * on its own, because its queue is FIFO with a single worker.
 */
export function isRunningAt(runs: MissionRun[], yardId: string): boolean {
  return runs.some((r) => r.yardId === yardId && r.status === 'processing');
}
