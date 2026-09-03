/**
 * Mission Repository Interface
 *
 * Implements the Repository pattern and Dependency Inversion Principle (SOLID).
 * Domain layer defines the contract; infrastructure layer provides concrete implementation.
 *
 * This allows us to:
 * - Swap Firestore for Redis, Cloud Tasks, or other queue systems
 * - Mock the repository for unit testing
 * - Keep business logic independent of persistence details
 */

import { Mission, MissionStatus } from '../entities/Mission';
import { MissionRun } from '../entities/MissionRun';

export interface IMissionRepository {
  /**
   * Create a new mission in the queue
   * @param mission - Mission data (id will be generated if not provided)
   * @returns Created mission with generated ID and calculated queue position
   */
  create(mission: Omit<Mission, 'id'>): Promise<Mission>;

  /**
   * Find a mission by ID
   * @param id - Mission ID
   * @returns Mission or null if not found
   */
  findById(id: string): Promise<Mission | null>;

  /**
   * Update mission status and related fields
   * @param id - Mission ID
   * @param updates - Partial mission data to update
   * @returns Updated mission or null if not found
   */
  update(id: string, updates: Partial<Mission>): Promise<Mission | null>;

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

  /** Record one yard's attempt, creating or replacing it. */
  upsertRun(missionId: string, run: MissionRun): Promise<void>;

  /**
   * Apply an operator's decision to a run, and roll the mission's own status
   * up from it. One write, because a run and its mission disagreeing is the
   * bug this exists to prevent.
   */
  applyBookkeeping(
    missionId: string,
    yardId: string,
    change: {
      status?: MissionStatus | null;
      youtubeUrl?: string;
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
}

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
