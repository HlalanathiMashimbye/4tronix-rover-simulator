/**
 * Missions on the Firebase Admin SDK: the server's repository.
 *
 * The Admin SDK bypasses Firestore rules, so this is the only class that
 * writes a mission, and it is only ever built in container.server.ts, which
 * `server-only` keeps out of the browser bundle. Reading is inherited from
 * FirestoreMissionReader; this class adds the fetches in the Admin SDK's shape
 * and the writes nothing else may make.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import type { MissionRecord, MissionStatus } from '@/core/domain/entities/Mission';
import type { IMissionRepository, MissionCursor, QueuedNotificationOutcome } from '@/core/domain/repositories/IMissionRepository';
import { FirestoreMissionReader } from './FirestoreMissionReader';
import {
  MISSIONS_COLLECTION,
  RUNS_SUBCOLLECTION,
  missionToDocument,
  type DocumentLike,
  type MissionDocData,
} from './missionDocuments';

export class AdminFirestoreMissionRepository extends FirestoreMissionReader implements IMissionRepository {
  constructor(private readonly db: Firestore) {
    super();
  }

  async create(mission: Omit<MissionRecord, 'id' | 'submittedAt'>): Promise<MissionRecord> {
    const id = nanoid();
    const submittedAt = (mission as { submittedAt?: string }).submittedAt || new Date().toISOString();
    const newMission: MissionRecord = { ...mission, id, submittedAt };

    await this.db.collection(MISSIONS_COLLECTION).doc(id).set(missionToDocument(newMission));

    // No queue-position aggregation here. It cost an extra COUNT query on
    // every single submission, and nothing renders the result.
    return newMission;
  }

  /**
   * Record an operator's decision about a run, and roll it up onto the mission.
   *
   * ONE BATCH, TWO DOCUMENTS, AND BOTH ARE REQUIRED.
   *
   * The run is the truth. The mission carries a roll-up of it because the rest
   * of the app reads missions/{id}.status: getDiscoveryStatus turns it into the
   * learner's Completed/Pending, the feed sorts on it, and the operator queue
   * selects on it. Writing only the run would leave the operator staring at a
   * queue that did not change when they pressed the button, and every learner
   * seeing Pending for a mission that finished.
   *
   * The batch is what stops those two disagreeing. A half-applied decision is
   * worse than a failed one, because nothing would ever come back to fix it.
   *
   * CREATES THE RUN IF IT IS ABSENT, which is the offline-yard case rather than
   * an edge case. A satellite with no network never flushes its run outbox, so
   * a mission somebody ran by hand this afternoon may exist only in that Pi's
   * SQLite. The desk still has to be able to settle it.
   *
   * `decidedAt` is not decoration. It is what the satellite's flush compares
   * against when it finally reconnects and tries to replay stale machine events
   * over the top of this.
   */
  async applyBookkeeping(
    missionId: string,
    runId: string,
    yardId: string,
    change: {
      status?: MissionStatus | null;
      youtubeUrl?: string;
      clearsVideo?: boolean;
      clearsReview?: boolean;
      feedback?: string;
      decidedAt: string;
      decidedBy: string;
    },
  ): Promise<void> {
    const runFields: Record<string, unknown> = {
      yardId,
      decidedAt: change.decidedAt,
      decidedBy: change.decidedBy,
    };
    const missionFields: Record<string, unknown> = {};

    if (change.status) {
      runFields.status = change.status;
      runFields.statusUpdatedAt = change.decidedAt;
      missionFields.status = change.status;
      missionFields.statusUpdatedAt = change.decidedAt;

      // Only completion carries a completedAt. A cancelled run did not finish,
      // and stamping one would put it in the learner's watchable list ordering
      // as though it had.
      if (change.status === 'completed') {
        runFields.completedAt = change.decidedAt;
        missionFields.completedAt = change.decidedAt;
      }
    }

    if (change.clearsVideo) {
      // Written as null rather than deleted: toRun reads the field straight
      // through, and a null is what the rest of the code already treats as
      // "no video" - youtubeUrl is optional everywhere it is consumed.
      runFields.youtubeUrl = null;
      missionFields.youtubeUrl = null;
    } else if (change.youtubeUrl) {
      runFields.youtubeUrl = change.youtubeUrl;
      // Mirrored onto the mission for the same reason as status: missions that
      // predate the run model still read their video from there.
      missionFields.youtubeUrl = change.youtubeUrl;
    }

    if (change.feedback !== undefined) {
      // Run only, never mirrored onto the mission. Feedback is about one
      // yard's attempt, and a second yard's run should not inherit a note
      // written about the first.
      runFields.feedback = change.feedback;
      runFields.feedbackBy = change.decidedBy;
      runFields.feedbackAt = change.decidedAt;
    }

    if (change.clearsReview) {
      runFields.needsReview = false;
      runFields.reviewReason = null;
      missionFields.needsReview = false;
      missionFields.reviewReason = null;
    }

    const missionRef = this.db.collection(MISSIONS_COLLECTION).doc(missionId);
    const batch = this.db.batch();

    batch.set(missionRef.collection(RUNS_SUBCOLLECTION).doc(runId), runFields, { merge: true });
    if (Object.keys(missionFields).length > 0) {
      batch.set(missionRef, missionFields, { merge: true });
    }

    await batch.commit();
  }

  /**
   * Soft-delete a mission.
   *
   * Soft on purpose, and the asymmetry is the point: the console offers the
   * operator no undo and warns them it is permanent, while the record survives
   * for someone who can reach the database. A mis-tap on a child's work should
   * be recoverable by a human even though the interface promises it is not.
   */
  async softDeleteRun(
    missionId: string,
    runId: string,
    deletedAt: string,
    deletedBy: string,
  ): Promise<void> {
    await this.db
      .collection(MISSIONS_COLLECTION)
      .doc(missionId)
      .collection(RUNS_SUBCOLLECTION)
      .doc(runId)
      .set({ deleted: true, deletedAt, deletedBy }, { merge: true });
  }

  async softDeleteMission(missionId: string, deletedAt: string, deletedBy: string): Promise<void> {
    await this.db
      .collection(MISSIONS_COLLECTION)
      .doc(missionId)
      .set({ deleted: true, deletedAt, deletedBy }, { merge: true });
  }

  /**
   * Stamp notifiedQueuedAt once, and only while the mission is still queued.
   *
   * The whole check and the write are one transaction so the notify route
   * cannot send the queued email twice: whoever reads notifiedQueuedAt absent
   * and writes it wins, and a second caller reads it present and gets
   * 'already'. The field lives only here, never on the public Mission entity,
   * so nothing a browser reads changes.
   */
  async recordQueuedNotification(missionId: string): Promise<QueuedNotificationOutcome> {
    const ref = this.db.collection(MISSIONS_COLLECTION).doc(missionId);
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return 'not-found';

      const data = snapshot.data() as { status?: string; notifiedQueuedAt?: string } | undefined;
      if (data?.status !== 'queued') return 'not-queued';
      if (data?.notifiedQueuedAt) return 'already';

      tx.set(ref, { notifiedQueuedAt: new Date().toISOString() }, { merge: true });
      return 'recorded';
    });
  }

  protected async readMission(id: string): Promise<MissionDocData | null> {
    const snapshot = await this.db.collection(MISSIONS_COLLECTION).doc(id).get();
    return snapshot.exists ? (snapshot.data() as MissionDocData) : null;
  }

  protected async readIdRange(start: string, end: string, max: number): Promise<DocumentLike[]> {
    const snapshot = await this.db
      .collection(MISSIONS_COLLECTION)
      .where('__name__', '>=', start)
      .where('__name__', '<', end)
      .limit(max)
      .get();
    return snapshot.docs;
  }

  protected async readRecent(max: number, cursor?: MissionCursor): Promise<DocumentLike[]> {
    let recent = this.db
      .collection(MISSIONS_COLLECTION)
      .orderBy('submittedAt', 'desc')
      .orderBy('__name__', 'desc');
    if (cursor) recent = recent.startAfter(cursor.submittedAt, cursor.id);
    return (await recent.limit(max).get()).docs;
  }

  protected async readRuns(missionId: string): Promise<DocumentLike[]> {
    const snapshot = await this.db
      .collection(MISSIONS_COLLECTION)
      .doc(missionId)
      .collection(RUNS_SUBCOLLECTION)
      .get();
    return snapshot.docs;
  }
}
