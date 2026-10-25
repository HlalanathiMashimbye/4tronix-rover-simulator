/**
 * Mission Repository Interfaces
 *
 * Implements the Repository pattern and Dependency Inversion Principle (SOLID).
 * Domain layer defines the contract; infrastructure layer provides concrete implementation.
 *
 * Split by what callers actually do (Interface Segregation). One nine-method
 * interface used to serve everyone, and no caller used more than five of its
 * methods: the public feed needs findRecent, a mission page findById and
 * findRuns, MissionService create and findById. The browser container
 * handed all nine to client components, so code that ships to a child's
 * browser was typed as able to soft-delete missions. Firestore rules would
 * refuse that write, but nothing stopped anyone writing the call.
 *
 * - IMissionReader: what anyone may read. The browser gets only this.
 * - IMissionWriter: creating a mission. Status changes go through
 *   IMissionBookkeeping, never a free-form update, so no caller can set a
 *   status the lifecycle (MissionState) does not allow.
 * - IMissionBookkeeping: an operator's record of runs, and soft deletion.
 * - IMissionRepository: all three, for the privileged server container.
 */

import { Mission, MissionStatus } from '../entities/Mission';
import { MissionRun } from '../entities/MissionRun';

export interface IMissionReader {
  /**
   * Find a mission by ID
   * @param id - Mission ID
   * @returns Mission or null if not found
   */
  findById(id: string): Promise<Mission | null>;

  /**
   * Missions whose ID starts with `prefix`, at most `max`, deleted ones left
   * out. What a /missions/<name>-<prefix> link resolves through; see
   * services/missionSlug. Reads one document per match, so one for a link
   * whose prefix is unique, the same as findById.
   */
  findByIdPrefix(prefix: string, max: number): Promise<Mission[]>;

  /**
   * A page of recent missions, newest first. Reads `limit + 1` documents - no
   * queue-position aggregations, which the feed never shows.
   *
   * Pass the previous page's `nextCursor` to continue. Cursor-based rather
   * than offset-based because Firestore bills every document an offset skips
   * over, so page 5 of an offset scheme costs five pages' worth of reads.
   */
  findRecent(limit: number, cursor?: MissionCursor): Promise<MissionPage>;

  /**
   * Every yard's attempt at this mission.
   *
   * A mission is a program; a run is one yard's attempt at it, and any yard
   * may run any mission. The learner's page shows the runs that produced a
   * video, which is also how a failed run stays invisible to them.
   */
  findRuns(missionId: string): Promise<MissionRun[]>;
}

export interface IMissionWriter {
  /**
   * Create a new mission in the queue
   * @param mission - Mission data (id will be generated if not provided)
   * @returns Created mission with generated ID and calculated queue position
   */
  create(mission: Omit<Mission, 'id'>): Promise<Mission>;
}

export interface IMissionBookkeeping {
  /**
   * Apply an operator's decision to a run, and roll the mission's own status
   * up from it. One write, because a run and its mission disagreeing is the
   * bug this exists to prevent.
   */
  applyBookkeeping(
    missionId: string,
    runId: string,
    yardId: string,
    change: {
      status?: MissionStatus | null;
      youtubeUrl?: string;
      /** Take the video off this run. Distinct from not supplying one. */
      clearsVideo?: boolean;
      clearsReview?: boolean;
      /** An operator's note to the learner. Written to the run, not the mission. */
      feedback?: string;
      decidedAt: string;
      decidedBy: string;
    },
  ): Promise<void>;

  /**
   * Hide a mission without destroying it. Soft, because a mission is a
   * child's work and the operator pressing delete is usually removing it from
   * a public feed, not asking for it to be unrecoverable.
   */
  softDeleteMission(missionId: string, deletedAt: string, deletedBy: string): Promise<void>;

  /**
   * Remove one attempt from a mission's history.
   *
   * Soft, for the same reason a mission is: a run is the record that a child's
   * program was actually driven on a rover, and an operator tidying a
   * mis-logged attempt should not be able to erase the fact that an attempt
   * happened. findRuns filters these out, so the console and the learner both
   * stop seeing it.
   */
  softDeleteRun(
    missionId: string,
    runId: string,
    deletedAt: string,
    deletedBy: string,
  ): Promise<void>;
}

/**
 * The one write a browser may make to a mission: stamping the hash of a
 * learner's email onto a mission submitted before they gave one, so its
 * completion email can find them. Firestore rules allow it only when the
 * mission has no hash yet, and only a 64-character hex digest.
 */
export interface ILearnerEmailStamp {
  /** True when this stamped it; false when it was already stamped or there is no such mission. */
  stampLearnerEmailHash(missionId: string, emailHash: string): Promise<boolean>;
}

/** What recordQueuedNotification found and did. */
export type QueuedNotificationOutcome = 'recorded' | 'already' | 'not-queued' | 'not-found';

/**
 * Records, once, that the "queued" email has been sent for a mission.
 *
 * POST /api/missions/[id]/notify sends that email, and its only caller fires
 * once per freshly submitted mission (LearnerContext.backfillLatestMissionEmail,
 * after a learner gives an address). Before this, the route accepted any status
 * for any mission id from anyone, so a public mission id was a lever for sending
 * a learner mail. This narrows it: the email is sent only while the mission is
 * still queued, and only the first time.
 *
 * A transaction decides and stamps in one step, so two calls racing cannot both
 * send. 'recorded' when this call stamped it; 'already' when a previous one did;
 * 'not-queued' or 'not-found' when there was nothing to notify.
 */
export interface IQueuedNotificationRecorder {
  recordQueuedNotification(missionId: string): Promise<QueuedNotificationOutcome>;
}

/** Everything, for the server container. Prefer the narrow interface you need. */
export interface IMissionRepository
  extends IMissionReader, IMissionWriter, IMissionBookkeeping, IQueuedNotificationRecorder {}

/** Where a page ended. Both ordering fields, so ties cannot skip or repeat. */
export interface MissionCursor {
  submittedAt: string;
  id: string;
}

export interface MissionPage {
  missions: Mission[];
  /** null when there is nothing after this page. */
  nextCursor: MissionCursor | null;
}
