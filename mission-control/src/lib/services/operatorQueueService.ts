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
 * runtime selection from YardPicker and this re-subscribes when it changes.
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import { getFirestoreClient } from '@/lib/firebase';
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

/** Only what the queue renders. Mission documents carry a good deal more. */
export interface QueueMission {
  id: string;
  name?: string;
  code: string;
  blocklyState?: string;
  status: MissionStatus;
  submittedAt?: string;
  learnerRef?: string;
  needsReview?: boolean;
  reviewReason?: string | null;
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
          learnerRef: data.learnerRef,
          needsReview: data.needsReview,
          reviewReason: data.reviewReason ?? null,
        });
      }

      onMissions(missions);
    },
    (error) => {
      console.error('[operator queue] listener failed:', error);
      onError(error);
    },
  );
}
