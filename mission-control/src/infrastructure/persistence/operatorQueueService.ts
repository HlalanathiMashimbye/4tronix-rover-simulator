/**
 * The live queue for one yard (AB#376).
 *
 * A Firestore listener rather than a poll, so an operator sees a mission arrive
 * as a learner submits it. The satellite still owns execution; this is a window
 * onto the same documents it reads.
 *
 * SCOPED BY THE YARD THE OPERATOR CHOSE, not by anything on their account. The
 * card for this task says "scoped by the operator's yardIds", which is out of
 * date: David rejected per-account yards on 2026-08-27, so the yard is a
 * yard the operator signed in at, fixed for the session.
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';

import { getFirestoreClient } from '@/infrastructure/persistence/firebase-client';
import type { MissionStatus } from '@/core/domain/entities/Mission';

/**
 * What "the queue" means: waiting, or running right now.
 *
 * Finished missions are deliberately absent. An operator watching a queue wants
 * what still needs them; completed work belongs to the bookkeeping views.
 */
export const ACTIVE_STATUSES: MissionStatus[] = ['queued', 'processing'];

/**
 * Upper bound on the listener.
 *
 * A live listener reads every matching document when it attaches, and
 * re-attaches on every mount. An unbounded queue subscription is a read bill
 * that grows with the backlog, and no operator works through more than this in
 * a session. Same reasoning as HISTORY_LIMIT in missionQueryService.
 */
export const QUEUE_LIMIT = 50;

/**
 * Smaller than the queue on purpose. This view exists to get back to a mission
 * finished minutes ago, not to browse a yard's history, which the learner feed
 * already does properly with pagination.
 */
export const DONE_LIMIT = 25;

/**
 * Only what the queue renders. Mission documents carry a good deal more.
 *
 * NO LEARNER FIELD, DELIBERATELY. Not even `learnerRef`, which is a one-way
 * hash and therefore harmless in itself. AB#377 asked the queue to show who
 * submitted each mission, and that cuts against the anonymity the platform has
 * held to from the start: learners are not Auth users, ids are hashed before
 * they touch a mission, and addresses live where browsers cannot read them.
 * The mission NAME is the handle an operator needs, and it identifies nobody.
 */
export interface QueueMission {
  id: string;
  name?: string;
  code: string;
  blocklyState?: string;
  status: MissionStatus;
  submittedAt?: string;
  needsReview?: boolean;
  reviewReason?: string | null;
  /** Present once an operator has attached the recording. */
  youtubeUrl?: string;
}

/**
 * Subscribe to one yard's active missions.
 *
 * `onError` is not optional. A listener that fails silently renders an empty
 * queue, and an empty queue is indistinguishable from a working one with
 * nothing in it - which is exactly how a yard-id mismatch hid on the satellite.
 * The caller must be able to say "this is broken" rather than "this is quiet".
 */
export function subscribeToYardQueue(
  yardId: string,
  onMissions: (missions: QueueMission[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = getFirestoreClient();

  // Matches the existing composite index (status, yardId, submittedAt), so this
  // needs no new index. `in` fans out across the two active statuses.
  const q = query(
    collection(db, 'missions'),
    where('yardId', '==', yardId),
    where('status', 'in', ACTIVE_STATUSES),
    orderBy('submittedAt', 'asc'),
    limit(QUEUE_LIMIT),
  );

  return listen(q, onMissions, onError, 'queue');
}

/**
 * Recently completed missions at one yard.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE QUEUE. Attaching a video is a desk job
 * that happens AFTER a mission is marked complete: the operator settles the
 * run, downloads the recording from the satellite, uploads it, and comes back
 * with a link. By then the mission has left the queue, so without this there is
 * no way back to it and the attach action is unreachable.
 *
 * Newest first, because the mission somebody just finished is the one they are
 * coming back to. That ordering needs its own composite index; the queue's
 * ascending twin cannot be scanned backwards for it.
 *
 * SUBSCRIBE ONLY WHEN THE OPERATOR ASKS FOR IT. A listener reads every matching
 * document when it attaches, and completed missions only ever accumulate, so
 * attaching this alongside the queue would add a growing read bill to every
 * console session for a view most of them never open.
 */
export function subscribeToYardCompleted(
  yardId: string,
  onMissions: (missions: QueueMission[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = getFirestoreClient();

  const q = query(
    collection(db, 'missions'),
    where('yardId', '==', yardId),
    where('status', '==', 'completed'),
    orderBy('submittedAt', 'desc'),
    limit(DONE_LIMIT),
  );

  return listen(q, onMissions, onError, 'completed');
}

/** Shared by both subscriptions: the same documents, read the same way. */
function listen(
  q: Query,
  onMissions: (missions: QueueMission[]) => void,
  onError: (error: Error) => void,
  label: string,
): Unsubscribe {
  return onSnapshot(
    q,
    (snapshot) => {
      const missions: QueueMission[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();

        // Soft-deleted missions stay out of every view, operator included. An
        // operator removed it on purpose; showing it back to them as work
        // waiting would undo that decision by accident.
        if (data.deleted) continue;

        missions.push({
          id: doc.id,
          name: data.name,
          code: data.code ?? '',
          blocklyState: data.blocklyState,
          status: data.status,
          submittedAt: data.submittedAt,
          needsReview: data.needsReview,
          reviewReason: data.reviewReason ?? null,
          youtubeUrl: data.youtubeUrl,
        });
      }

      onMissions(missions);
    },
    (error) => {
      console.error(`[operator ${label}] listener failed:`, error);
      onError(error);
    },
  );
}
