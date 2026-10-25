/**
 * What a mission's status means, answered in one place.
 *
 * The status itself stays a plain string on MissionRecord, because that
 * record crosses the Firestore and server-to-browser boundaries, and neither
 * carries a class. This is the behaviour that goes with it. It exists because
 * the meaning was being re-derived wherever someone needed it, and the copies
 * disagreed: the operator card treated only completed and cancelled as
 * settled, while the server treated failed and not_completed as settled too.
 * So a run that did not finish offered Mark complete, which the server always
 * refused, and hid the note box, on the one kind of run whose learner most
 * needs a note.
 *
 * The Mission entity decides operator actions with these same rules, so the
 * console offers exactly what the server will accept.
 */

import type { MissionStatus } from './Mission';

export type LearnerFacingStatus = 'Completed' | 'Pending';

export class MissionState {
  /** Waiting on someone: in the queue, or on the rover now. */
  static readonly OPEN: readonly MissionStatus[] = ['queued', 'processing'];

  /**
   * Every status a mission can end in. The operator's Done list reads exactly
   * these, so a cancelled mission stays findable: cancel exists to keep a
   * child's work rather than delete it. 'failed' is here although nothing
   * writes it today, because the status exists and a mission that arrives with
   * it must not drop out of every view.
   */
  static readonly SETTLED: readonly MissionStatus[] = ['completed', 'failed', 'not_completed', 'cancelled'];

  private constructor(readonly status: MissionStatus) {}

  static of(status: MissionStatus): MissionState {
    return new MissionState(status);
  }

  isOpen(): boolean {
    return MissionState.OPEN.includes(this.status);
  }

  isSettled(): boolean {
    return !this.isOpen();
  }

  /** The run finished. The only state with a video to watch or a program worth remixing. */
  isCompleted(): boolean {
    return this.status === 'completed';
  }

  /** Ended without finishing: the rover stopped short, or the mission never ran. */
  stoppedShort(): boolean {
    return this.isSettled() && !this.isCompleted();
  }

  /**
   * Completed or Pending, never Failed. A learner should not see their own
   * mission marked as a failure; the operator console shows the real status.
   */
  learnerFacing(): LearnerFacingStatus {
    return this.isCompleted() ? 'Completed' : 'Pending';
  }

  /** Re-completing a settled mission would only move its timestamps. */
  canComplete(): boolean {
    return this.isOpen();
  }

  /**
   * Allowed while running, because a run stuck in processing after the yard
   * lost signal is exactly what needs clearing from a desk. Cancelling records
   * an outcome; it does not reach the rover.
   */
  canCancel(): boolean {
    return this.isOpen();
  }

  /** A second attempt is logged after the first one settles, never alongside it. */
  canLogAnotherRun(): boolean {
    return this.isSettled();
  }

  /** A video on an unfinished run would be one the learner watches while it still reads Pending. */
  canAttachVideo(): boolean {
    return this.isCompleted();
  }

  canRemoveVideo(): boolean {
    return this.isSettled();
  }

  /**
   * Only on a run that happened. A cancelled mission never ran, so a note on
   * it would be a verdict on nothing; one that ran and did not finish is the
   * mission a child most needs a sentence about.
   */
  canTakeFeedback(): boolean {
    return this.status === 'completed' || this.status === 'failed' || this.status === 'not_completed';
  }

  equals(other: MissionState): boolean {
    return this.status === other.status;
  }

  toString(): string {
    return this.status;
  }
}
