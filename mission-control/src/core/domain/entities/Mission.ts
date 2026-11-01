/**
 * A mission: a program a learner wrote, and every attempt to run it.
 *
 * Two shapes, on purpose. `MissionRecord` is the stored data: it crosses
 * Firestore and the server-to-browser boundary, and neither carries a class,
 * so the feed and the cards read it as plain data. `Mission` is the entity
 * the server acts through. It holds one record and its runs privately, and it
 * is the only place that decides what an operator may do to them, so no
 * caller can put a status on a mission that its lifecycle (MissionState) does
 * not allow.
 */

import type { MissionRun } from './MissionRun';
import { MissionState } from './MissionState';

export type MissionStatus =
  | 'queued'        // Waiting to be executed
  | 'processing'    // Currently being executed by rover
  | 'completed'     // Successfully executed
  | 'failed'        // Execution failed (learner-facing: shown as pending)
  | 'not_completed' // Real rover run did not finish successfully
  | 'cancelled';    // Cancelled by operator or system

export interface ExecutionResult {
  isSuccessful: boolean;
  consoleOutput: string;
  errorMessage?: string;
}

export interface ExecutionMetadata {
  duration_ms?: number;
  error?: string;
  completed_at: string;
}

/** The stored shape of a mission. Read freely; change it only through Mission. */
export interface MissionRecord {
  // Identifiers
  id: string;                        // Firestore document ID
  yardId: string;                    // Which physical rover yard, named for the rover itself (e.g., "curiosity")

  // Challenge tracking (optional - missions may be freeform or challenge-based)
  challengeId?: string;              // Challenge ID if this mission is for a specific challenge

  // Learner tracking
  //
  // A one-way hash of the learner's id, NEVER the id itself. Mission documents
  // are world-readable, and the feed used to print the raw id on every card, so
  // publishing it meant possession of an id proved nothing - which is why
  // anything accepting one could not authenticate its caller. The raw id stays
  // in localStorage; a learner finds their own history by hashing it and
  // querying this. See core/domain/services/learnerRef.ts
  learnerRef: string;
  sessionId: string;                 // Browser fingerprint for history tracking (kept for backward compatibility)
  // One-way hash of the learner's email, NEVER the address itself: mission
  // documents are world-readable, so a plaintext address here is public. Lets a
  // learner find their missions from another device by hashing the address they
  // already know. The real address lives on the learner record.
  // See core/domain/services/learnerEmailHash.ts
  learnerEmailHash?: string;

  // Payload
  name?: string;                     // Optional - mission name given by learner
  code: string;                      // Python code submitted by learner
  blocklyState?: string;             // Serialized Blockly workspace JSON (block-built missions only)

  // Provenance, carried but never set on this branch. The Progressive
  // Challenges feature that writes it lives on feat/challenges (see
  // docs/challenges-branch.md); these two fields deliberately stay here so a
  // mission written by that branch round-trips through this one unchanged,
  // and so Mission.ts is not a merge conflict every time the branch rebases.
  origin?: 'challenge';

  status: MissionStatus;

  // Soft delete. An operator removed this mission; it stays out of every
  // learner-facing view. Soft rather than hard so a mis-tap on a child's work
  // is recoverable by someone with database access - the operator console
  // offers no undo and says so.
  deleted?: boolean;
  deletedAt?: string;

  // Execution results (populated after execution)
  executionResult?: ExecutionResult;
  executionMetadata?: ExecutionMetadata;

  // Review
  needsReview?: boolean;              // Whether the mission needs review (e.g., for failed missions)
  reviewReason?: string | null;              // Optional - reason for review (e.g., "syntax error", "failed test case")

  // Conflict resolution
  statusUpdatedAt?: string | null;          // When the status was last updated (for conflict resolution)

  // Media artifacts
  videoUrl?: string;                 // Google Cloud Storage URL
  youtubeUrl?: string;               // Optional YouTube share URL

  // Timestamps (all stored as ISO strings for Firestore compatibility)
  submittedAt: string;               // When mission was submitted
  startedAt?: string;                // When execution began
  completedAt?: string;              // When execution finished
}

/** What a new mission brings with it. Its status and submission time are the entity's to set. */
export type NewMission = Omit<MissionRecord, 'id' | 'status' | 'submittedAt'>;

export type ResolveOutcome = 'completed' | 'requeue';

export interface StatusChange {
  /** The new run status, or null to leave it alone (attaching a video, a note). */
  status: MissionStatus | null;
  clearsReview: boolean;
}

export type Decision =
  | { ok: true; change: StatusChange }
  | { ok: false; error: string };

const UNCHANGED: Decision = { ok: true, change: { status: null, clearsReview: false } };

export class Mission {
  private constructor(
    private readonly record: Readonly<MissionRecord>,
    private readonly attempts: readonly MissionRun[],
  ) {}

  /** A mission as stored, with whatever runs have reached Firestore. */
  static restore(record: MissionRecord, runs: readonly MissionRun[] = []): Mission {
    return new Mission({ ...record }, [...runs]);
  }

  /** Every mission starts queued, stamped with when it arrived. */
  static submit(fields: NewMission, now: Date): Omit<MissionRecord, 'id'> {
    return { ...fields, status: 'queued', submittedAt: now.toISOString() };
  }

  /**
   * A finished run with no video yet: the operator's outstanding work. A
   * cancelled mission never ran, so it has no recording to look for.
   *
   * Static, and takes only the two fields it reads, so the operator queue's
   * narrower record answers it too.
   */
  static stillNeedsVideo(mission: { status: MissionStatus; youtubeUrl?: string | null }): boolean {
    return MissionState.of(mission.status).canAttachVideo() && !mission.youtubeUrl;
  }

  get id(): string {
    return this.record.id;
  }

  get status(): MissionStatus {
    return this.record.status;
  }

  get state(): MissionState {
    return MissionState.of(this.record.status);
  }

  get isDeleted(): boolean {
    return this.record.deleted === true;
  }

  get runs(): readonly MissionRun[] {
    return this.attempts;
  }

  run(runId: string): MissionRun | null {
    return this.attempts.find((r) => r.runId === runId) ?? null;
  }

  /**
   * The latest run at this yard, not the first match: a yard can attempt a
   * mission twice, and "mark complete" means the attempt in front of the
   * operator.
   */
  latestRunAt(yardId: string): MissionRun | null {
    return (
      this.attempts
        .filter((r) => r.yardId === yardId)
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0] ?? null
    );
  }

  /**
   * The status an operator at this yard is acting on. The run wins, because it
   * is the record of an actual attempt. With no run, the mission's own status:
   * a yard with no network never flushes its runs, and the desk still has to
   * be able to settle a mission somebody ran there by hand.
   */
  statusAt(yardId: string): MissionStatus {
    return this.latestRunAt(yardId)?.status ?? this.record.status;
  }

  needsReviewAt(yardId: string): boolean {
    return this.latestRunAt(yardId)?.needsReview ?? this.record.needsReview ?? false;
  }

  /** The operator checked, and the run finished. Completing also settles a review. */
  complete(yardId: string): Decision {
    if (!this.stateAt(yardId).canComplete()) {
      return this.refuse(`This mission is already ${this.statusAt(yardId)}, so there is nothing to complete.`);
    }
    return { ok: true, change: { status: 'completed', clearsReview: true } };
  }

  /**
   * Cancel rather than delete: the record of a child's work survives, and
   * reads as Pending to them rather than as a rejection. Allowed while running,
   * because a run stuck in processing after the yard lost signal is what most
   * needs clearing from a desk. It records an outcome; it does not reach the
   * rover.
   */
  cancel(yardId: string): Decision {
    if (!this.stateAt(yardId).canCancel()) {
      return this.refuse(`This mission is already ${this.statusAt(yardId)}, so there is nothing to cancel.`);
    }
    return { ok: true, change: { status: 'cancelled', clearsReview: true } };
  }

  /**
   * A second attempt, logged by the operator who watched it finish. Explicit
   * rather than inferred from a second upload, because a video is evidence of
   * an upload, not of a run.
   */
  logAnotherRun(yardId: string): Decision {
    if (!this.stateAt(yardId).canLogAnotherRun()) {
      return this.refuse(`This mission is still ${this.statusAt(yardId)}. Settle the current run before logging another.`);
    }
    return { ok: true, change: { status: 'completed', clearsReview: true } };
  }

  /** Completed only: a video on an unfinished run is one the learner watches while it reads Pending. */
  attachVideo(yardId: string): Decision {
    if (!this.stateAt(yardId).canAttachVideo()) {
      return this.refuse('Mark the mission complete before attaching its video.');
    }
    return UNCHANGED;
  }

  /** For a recording taken down, which leaves the run with none rather than a different one. */
  removeVideo(yardId: string): Decision {
    if (!this.stateAt(yardId).canRemoveVideo()) {
      return this.refuse('This run has not finished, so it has no video to remove.');
    }
    return UNCHANGED;
  }

  /**
   * Only on a run that happened. A run that did not finish still takes one: it
   * is the mission a child most needs a sentence about, and their status still
   * reads Pending, never Failed.
   */
  leaveFeedback(yardId: string): Decision {
    if (!this.stateAt(yardId).canTakeFeedback()) {
      return this.refuse('Wait until the mission has run before leaving feedback on it.');
    }
    return UNCHANGED;
  }

  /** Settle a mission the satellite flagged for review. Requeue never dispatches: a person sends it again. */
  resolve(yardId: string, outcome: ResolveOutcome): Decision {
    if (!this.needsReviewAt(yardId)) {
      return this.refuse('This mission is not waiting on a review.');
    }
    return {
      ok: true,
      change: { status: outcome === 'completed' ? 'completed' : 'queued', clearsReview: true },
    };
  }

  /** A copy of the stored data, for a caller that hands it on, such as the learner's email. */
  toRecord(): MissionRecord {
    return { ...this.record };
  }

  private stateAt(yardId: string): MissionState {
    return MissionState.of(this.statusAt(yardId));
  }

  private refuse(error: string): Decision {
    return { ok: false, error };
  }
}
