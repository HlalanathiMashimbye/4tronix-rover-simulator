/**
 * Firestore Mission Repository Implementation
 *
 * Concrete implementation of IMissionRepository using Firestore.
 * Firestore acts as both persistent storage AND queue.
 *
 * Queue semantics (inspired by yard/rover/service.py):
 * - FIFO ordering by submittedAt timestamp
 * - Automatic queue position calculation
 * - Supports real-time updates via Firestore listeners (future)
 *
 * Performance considerations:
 * - Indexed queries on yardId + status for fast queue retrieval
 * - Batch operations for atomic updates
 */

import { Firestore as AdminFirestore } from 'firebase-admin/firestore';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  setDoc,
  updateDoc,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';
import { nanoid } from 'nanoid';
import { Mission, type MissionStatus } from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import {
  IMissionRepository,
  MissionCursor,
  MissionPage,
} from '@/core/domain/repositories/IMissionRepository';

const MISSIONS_COLLECTION = 'missions';
const RUNS_SUBCOLLECTION = 'runs';

type FirestoreLike = AdminFirestore | ClientFirestore;

// The admin and client Firestore SDKs have incompatible nominal types, so this
// repository reads snapshots through the minimal structural shapes it actually
// uses rather than `any`.
type MissionDocData = Record<string, unknown>;
type MissionDocSnapshot = { id: string; data: () => MissionDocData };
type QuerySnapshotLike = { docs: MissionDocSnapshot[] };
type DocSnapshotLike = { exists: boolean; data: () => MissionDocData | undefined };

export class FirestoreMissionRepository implements IMissionRepository {
  constructor(private readonly firestore: FirestoreLike) {}

  async create(mission: Omit<Mission, 'id' | 'submittedAt'>): Promise<Mission> {
    const id = nanoid();
    const submittedAt = (mission as { submittedAt?: string }).submittedAt || new Date().toISOString();

    const newMission: Mission = {
      ...mission,
      id,
      submittedAt,
    };

    await this.writeMission(id, newMission);

    // No queue-position aggregation here. It cost an extra COUNT query on
    // every single submission, and nothing renders the result - see the note
    // on calculateEstimatedWait. getQueuedMissions derives position from the
    // ordered result for free when it is genuinely needed.
    return newMission;
  }

  async findById(id: string): Promise<Mission | null> {
    const snapshot = await this.getMissionDoc(id);

    if (!snapshot.exists) {
      return null;
    }

    const mission = this.fromFirestoreDoc(id, snapshot.data()!);

    // A deleted mission reads as absent, so a shared link 404s rather than
    // showing work an operator removed.
    return mission.deleted ? null : mission;
  }

  async update(id: string, updates: Partial<Mission>): Promise<Mission | null> {
    const snapshot = await this.getMissionDoc(id);

    if (!snapshot.exists) {
      return null;
    }

    await this.updateMission(id, updates);
    return this.findById(id);
  }

  /**
   * Recent missions for the public feed. Reads exactly `limit` documents and
   * nothing else.
   *
   * findAll() is the wrong tool for the feed and was costing roughly 125 reads
   * per page view: it fetches 100 documents to render 24, then runs a COUNT
   * aggregation per queued mission to work out queue positions the feed never
   * displays. With 25 queued missions that is 25 extra round trips, which is
   * also why the page sat on a spinner for ~30 seconds.
   *
   * Queue position is genuinely needed on the history page, where a learner is
   * waiting on their own mission. It is not needed here, so it is not paid for.
   */
  async findRecent(limit: number, cursor?: MissionCursor): Promise<MissionPage> {
    // Fetch one extra to learn whether another page exists, without paying for
    // a separate count query.
    const snapshot = await this.getRecentMissionsSnapshot(limit + 1, cursor);
    const docs = snapshot.docs;

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const missions = page
      .map((missionDoc) => this.fromFirestoreDoc(missionDoc.id, missionDoc.data()))
      // Filtered here rather than in the query: `where('deleted','==',false)`
      // would need a composite index AND a backfill, since missions written
      // before soft delete existed have no such field. Deletions are rare, so
      // a page occasionally rendering fewer than FEED_SIZE cards is a better
      // trade than an index migration.
      .filter((mission) => !mission.deleted);

    const last = missions[missions.length - 1];

    return {
      missions,
      // Firestore pages by cursor, not offset - an offset would still read and
      // bill every skipped document. Both ordering fields are included so a
      // shared submittedAt cannot make a page skip or repeat a mission.
      nextCursor: hasMore && last ? { submittedAt: last.submittedAt, id: last.id } : null,
    };
  }

  /**
   * Convert Mission entity to Firestore document
   * Removes computed fields that shouldn't be persisted
   */
  private toFirestoreDoc(mission: Partial<Mission>): Record<string, unknown> {
    const persistedFields = { ...mission };

    if (typeof persistedFields.code === 'string') {
      persistedFields.code = this.normalizeMissionCode(persistedFields.code);
    }

    // Mission documents are world-readable. A plaintext learner address must
    // never reach one - only learnerEmailHash. The Mission type no longer has
    // the field, so this is a backstop against an untyped or legacy caller
    // (e.g. a partial update assembled from raw Firestore data) reintroducing
    // it silently.
    delete (persistedFields as Record<string, unknown>).learnerEmail;

    // Same backstop for the raw learner id. Publishing it is what made
    // possession of one meaningless, so only learnerRef (its hash) belongs on
    // a world-readable document. See core/domain/services/learnerRef.ts
    delete (persistedFields as Record<string, unknown>).learnerId;

    return this.removeUndefinedValues(persistedFields) as Record<string, unknown>;
  }

  private normalizeMissionCode(code: string): string {
    return code
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trimEnd())
      .filter((line) => line.trim().length > 0)
      .join('\n');
  }

  private isAdminFirestore(): boolean {
    return typeof (this.firestore as AdminFirestore).collection === 'function';
  }

  // Strongly-typed accessors. Branching on isAdminFirestore() alone leaves the
  // compiler with the admin|client union (whose CollectionReference shapes
  // differ), so each SDK is accessed through its own typed handle instead.
  private adminDb(): AdminFirestore {
    return this.firestore as AdminFirestore;
  }

  private clientDb(): ClientFirestore {
    return this.firestore as ClientFirestore;
  }

  /**
   * Every yard's attempt at a mission, from `missions/{id}/runs`.
   *
   * Dual-SDK like everything else here: the browser reads these to build the
   * learner's yard selector, the server writes them.
   *
   * Returns [] for a mission nobody has run, and for every mission submitted
   * before runs existed. Callers must treat "no runs" as ordinary rather than
   * missing data - most missions in the archive are in exactly that state
   * until the backfill runs.
   */
  async findRuns(missionId: string): Promise<MissionRun[]> {
    if (this.isAdminFirestore()) {
      const snapshot = await this.adminDb()
        .collection(MISSIONS_COLLECTION)
        .doc(missionId)
        .collection(RUNS_SUBCOLLECTION)
        .get();

      // Filtered here rather than in the query, for the same reason missions
      // are: runs written before soft delete existed carry no `deleted` field
      // at all, and a where() clause would silently drop every one of them.
      return snapshot.docs
        .filter((d) => !(d.data() as { deleted?: boolean }).deleted)
        .map((d) => this.toRun(d.id, d.data() as Partial<MissionRun>));
    }

    const snapshot = await getDocs(
      collection(this.clientDb(), MISSIONS_COLLECTION, missionId, RUNS_SUBCOLLECTION)
    );

    return snapshot.docs
      .filter((d) => !(d.data() as { deleted?: boolean }).deleted)
      .map((d) => this.toRun(d.id, d.data() as Partial<MissionRun>));
  }

  /**
   * Create or replace one yard's run.
   *
   * Server-side only in practice: `firestore.rules` denies every browser write
   * under a mission. Merged rather than overwritten so a later status change
   * does not wipe a youtubeUrl attached earlier, which is the ordering the
   * satellite actually produces - the video is linked minutes after the run
   * finishes.
   *
   * NO LONGER SINGLE-WRITER. This said "only one yard ever writes this
   * document, so there is nothing to contend with", which stopped being true
   * when operator bookkeeping moved to the desk: Mission Control now writes
   * runs too. Contention is still not handled HERE, because the two writers
   * settle it where they meet, in the satellite's outbox flush, under the rule
   * that a human decision outranks a replayed machine event. See
   * applyBookkeeping below and sync_worker.should_run_local_win.
   */
  async upsertRun(missionId: string, run: MissionRun): Promise<void> {
    const { runId, ...fields } = run;
    const payload = this.removeUndefinedValues({ ...fields }) as Record<string, unknown>;

    if (this.isAdminFirestore()) {
      await this.adminDb()
        .collection(MISSIONS_COLLECTION)
        .doc(missionId)
        .collection(RUNS_SUBCOLLECTION)
        .doc(runId)
        .set(payload, { merge: true });
      return;
    }

    await setDoc(
      doc(this.clientDb(), MISSIONS_COLLECTION, missionId, RUNS_SUBCOLLECTION, runId),
      payload,
      { merge: true }
    );
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
    if (!this.isAdminFirestore()) {
      // Firestore rules deny every browser write to a run, so a client-side
      // call could only ever fail at the server. Failing here says why.
      throw new Error('Operator bookkeeping requires the Admin SDK.');
    }

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

    const db = this.adminDb();
    const missionRef = db.collection(MISSIONS_COLLECTION).doc(missionId);
    const batch = db.batch();

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
    if (!this.isAdminFirestore()) {
      throw new Error('Deleting a run requires the Admin SDK.');
    }

    await this.adminDb()
      .collection(MISSIONS_COLLECTION)
      .doc(missionId)
      .collection(RUNS_SUBCOLLECTION)
      .doc(runId)
      .set({ deleted: true, deletedAt, deletedBy }, { merge: true });
  }

  async softDeleteMission(missionId: string, deletedAt: string, deletedBy: string): Promise<void> {
    if (!this.isAdminFirestore()) {
      throw new Error('Deleting a mission requires the Admin SDK.');
    }

    await this.adminDb()
      .collection(MISSIONS_COLLECTION)
      .doc(missionId)
      .set({ deleted: true, deletedAt, deletedBy }, { merge: true });
  }

  /** The document id IS the runId, so it is authoritative over any stored field. */
  private toRun(runId: string, data: Partial<MissionRun>): MissionRun {
    return {
      runId,
      yardId: data.yardId ?? '',
      status: data.status ?? 'queued',
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      youtubeUrl: data.youtubeUrl ?? undefined,
      needsReview: data.needsReview,
      reviewReason: data.reviewReason ?? null,
      statusUpdatedAt: data.statusUpdatedAt ?? null,
      // An operator's note to the learner. This mapper is an explicit
      // allowlist, so a field absent here is silently dropped between
      // Firestore and the page - which is exactly what happened when these
      // three were added to the entity and not to this list.
      feedback: data.feedback,
      feedbackBy: data.feedbackBy,
      feedbackAt: data.feedbackAt,
    };
  }

  private async getMissionDoc(id: string): Promise<DocSnapshotLike> {
    if (this.isAdminFirestore()) {
      const snapshot = await this.adminDb().collection(MISSIONS_COLLECTION).doc(id).get();
      return { exists: snapshot.exists, data: () => snapshot.data() as MissionDocData | undefined };
    }

    const snapshot = await getDoc(doc(this.clientDb(), MISSIONS_COLLECTION, id));
    return { exists: snapshot.exists(), data: () => snapshot.data() as MissionDocData | undefined };
  }

  private async writeMission(id: string, mission: Partial<Mission>): Promise<void> {
    const payload = this.toFirestoreDoc(mission);

    if (this.isAdminFirestore()) {
      await this.adminDb().collection(MISSIONS_COLLECTION).doc(id).set(payload);
      return;
    }

    await setDoc(doc(this.clientDb(), MISSIONS_COLLECTION, id), payload);
  }

  private async updateMission(id: string, updates: Partial<Mission>): Promise<void> {
    const payload = this.toFirestoreDoc(updates);

    if (this.isAdminFirestore()) {
      await this.adminDb().collection(MISSIONS_COLLECTION).doc(id).update(payload);
      return;
    }

    await updateDoc(doc(this.clientDb(), MISSIONS_COLLECTION, id), payload);
  }

  private async getRecentMissionsSnapshot(
    max: number,
    cursor?: MissionCursor
  ): Promise<QuerySnapshotLike> {
    if (this.isAdminFirestore()) {
      let adminQuery = this.adminDb()
        .collection(MISSIONS_COLLECTION)
        .orderBy('submittedAt', 'desc')
        .orderBy('__name__', 'desc');

      if (cursor) {
        adminQuery = adminQuery.startAfter(cursor.submittedAt, cursor.id);
      }

      return adminQuery.limit(max).get() as unknown as QuerySnapshotLike;
    }

    const constraints = [
      orderBy('submittedAt', 'desc'),
      orderBy('__name__', 'desc'),
      ...(cursor ? [startAfter(cursor.submittedAt, cursor.id)] : []),
      limit(max),
    ];

    const missionsQuery = query(collection(this.clientDb(), MISSIONS_COLLECTION), ...constraints);

    return (await getDocs(missionsQuery)) as unknown as QuerySnapshotLike;
  }

  /**
   * Firestore Admin rejects undefined values, including nested optional fields.
   */
  private removeUndefinedValues(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value
        .filter((item) => item !== undefined)
        .map((item) => this.removeUndefinedValues(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, nestedValue]) => nestedValue !== undefined)
          .map(([key, nestedValue]) => [key, this.removeUndefinedValues(nestedValue)])
      );
    }

    return value;
  }

  /**
   * Convert Firestore document to Mission entity
   */
  private fromFirestoreDoc(id: string, data: MissionDocData): Mission {
    return {
      id,
      yardId: data.yardId as string,
      learnerRef: data.learnerRef as string,
      sessionId: data.sessionId as string,
      learnerEmailHash: data.learnerEmailHash as string | undefined,
      learnerUid: data.learnerUid as string | undefined,
      name: data.name as string | undefined,
      code: data.code as string,
      blocklyState: data.blocklyState as string | undefined,
      origin: data.origin as Mission['origin'],
      challengeId: data.challengeId as string | undefined,
      status: data.status as Mission['status'],
      deleted: (data.deleted as boolean) ?? false,
      deletedAt: data.deletedAt as string | undefined,
      executionResult: data.executionResult as Mission['executionResult'],
      executionMetadata: data.executionMetadata as Mission['executionMetadata'],
      videoUrl: data.videoUrl as string | undefined,
      // Coerced, because removing a video writes null and this field is
      // typed as optional. Leaving the null would make every consumer's
      // `string | undefined` a lie.
      youtubeUrl: (data.youtubeUrl as string | null | undefined) ?? undefined,
      submittedAt: data.submittedAt as string,
      startedAt: data.startedAt as string | undefined,
      completedAt: data.completedAt as string | undefined,

       // Locking
      lockOwner: (data.lockOwner as string | null) ?? null,
      lockedAt: (data.lockedAt as string | null) ?? null,
      leaseExpiresAt: (data.leaseExpiresAt as string | null) ?? null,

      // Review
      needsReview: (data.needsReview as boolean) ?? false,
      reviewReason: (data.reviewReason as string | null) ?? null,

      // Conflict resolution: fall back to submittedAt for legacy docs
      statusUpdatedAt: (data.statusUpdatedAt as string) ?? (data.submittedAt as string),
      };
  }
}
