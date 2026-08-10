/**
 * Mission Query Service
 *
 * Provides real-time mission queries by learner ID.
 * Replaces the learner-specific subcollection pattern.
 *
 * Enables:
 * - Real-time mission status updates from operators
 * - Learner-specific mission history queries
 * - Efficient filtering by learnerId on main missions collection
 */

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  limit,
  Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { getFirestoreClient } from '@/lib/firebase';
import { Mission } from '@/core/domain/entities/Mission';
import { hashLearnerEmail } from '@/core/domain/services/learnerEmailHash';
import { hashLearnerId } from '@/core/domain/services/learnerRef';

/**
 * Upper bound on a learner's history subscription.
 *
 * Both history queries were unbounded. A live listener reads every matching
 * document when it attaches, and re-attaches on every mount - so a learner with
 * 40 missions paid 40 reads each time they opened the page, doubled because the
 * page runs two overlapping subscriptions (by id and by email hash).
 *
 * Nobody scrolls past their most recent 50 runs, so this caps the exposure
 * without changing what anyone actually sees.
 */
export const HISTORY_LIMIT = 50;

/**
 * Get all missions for a learner with real-time updates
 *
 * This enables instant UI updates when an operator completes execution
 * and adds video links or execution notes.
 *
 * The id is hashed here and the query matches on the hash: mission documents
 * are world-readable, so they carry only learnerRef. The raw id never leaves
 * this browser. See core/domain/services/learnerRef.ts
 *
 * Async because hashing is - the caller gets the unsubscribe via promise,
 * mirroring subscribeMissionsByLearnerEmail below.
 *
 * @param learnerId - Unique learner identifier (hashed before querying)
 * @param callback - Function called when missions update
 * @returns Unsubscribe function to stop listening
 */
export async function subscribeMissionsByLearnerId(
  learnerId: string,
  callback: (missions: Mission[]) => void
): Promise<Unsubscribe> {
  const learnerRef = await hashLearnerId(learnerId);
  const db = getFirestoreClient();
  const missionsRef = collection(db, 'missions');
  const q = query(
    missionsRef,
    where('learnerRef', '==', learnerRef),
    orderBy('submittedAt', 'desc'),
    limit(HISTORY_LIMIT)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const missions: Mission[] = [];
      snapshot.forEach((doc) => {
        const mission = convertTimestamps(doc.data() as Mission, doc.id);
        if (!mission.deleted) missions.push(mission);
      });
      callback(missions);
    },
    (error) => {
      console.error('Mission subscription error:', error);
      callback([]);
    }
  );
}

/**
 * Get all missions for a learner email with real-time updates.
 *
 * Used by the history page so a learner can see every mission they have ever
 * submitted under the same email, across devices/browsers.
 *
 * The address is hashed in the browser and the query matches on the hash:
 * mission documents are world-readable, so they never carry the address itself.
 * Hashing is async, so this returns the unsubscribe via a promise rather than
 * synchronously.
 *
 * @param learnerEmail - Email the learner identified with
 * @param callback - Function called when missions update
 * @returns Promise of an unsubscribe function
 */
export async function subscribeMissionsByLearnerEmail(
  learnerEmail: string,
  callback: (missions: Mission[]) => void
): Promise<Unsubscribe> {
  const learnerEmailHash = await hashLearnerEmail(learnerEmail);

  const db = getFirestoreClient();
  const missionsRef = collection(db, 'missions');
  const q = query(
    missionsRef,
    where('learnerEmailHash', '==', learnerEmailHash),
    orderBy('submittedAt', 'desc'),
    limit(HISTORY_LIMIT)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const missions: Mission[] = [];
      snapshot.forEach((doc) => {
        const mission = convertTimestamps(doc.data() as Mission, doc.id);
        if (!mission.deleted) missions.push(mission);
      });
      callback(missions);
    },
    (error) => {
      console.error('Mission (by email) subscription error:', error);
      callback([]);
    }
  );
}

/**
 * How many recent completions the notification bell tracks.
 *
 * Small on purpose. A listener bills one read per document when it attaches
 * and one per document that changes afterwards, so this is the per-tab cost of
 * having the bell on screen at all - paid once per session, not per poll. A
 * bigger window would cost more reads to tell the learner the same thing,
 * because nobody reads past the first few.
 */
export const COMPLETION_FEED_LIMIT = 8;

/**
 * Watch the most recently completed missions, whoever submitted them.
 *
 * Deliberately NOT scoped to the current learner: a learner's own missions
 * reach them by email, and the bell exists for the shared yard - "a rover just
 * finished someone's run" is the thing worth glancing up for, and the learner
 * may not have identified themselves at all.
 *
 * Ordered by completedAt with NO status filter, and the status checked in the
 * browser instead. Adding `where('status','==','completed')` would make this a
 * composite query, which Firestore refuses to serve until someone deploys a
 * new index - so the bell would stay dark in production until an infra change
 * landed. Ordering by a single field needs no such deployment.
 *
 * That relies on an invariant worth stating: completedAt is only ever written
 * when a mission completes, and is cleared on a rerun (yard mission_store.py,
 * the only writer). Documents missing the ordered field are excluded by
 * Firestore, so this query already returns completed missions only. The
 * client-side status check is belt and braces, not the load-bearing part.
 */
export function subscribeRecentCompletions(
  callback: (missions: Mission[]) => void,
  max: number = COMPLETION_FEED_LIMIT
): Unsubscribe {
  const db = getFirestoreClient();
  const q = query(
    collection(db, 'missions'),
    orderBy('completedAt', 'desc'),
    limit(max)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const missions: Mission[] = [];
      snapshot.forEach((doc) => {
        const mission = convertTimestamps(doc.data() as Mission, doc.id);
        if (!mission.deleted && mission.status === 'completed') missions.push(mission);
      });
      callback(missions);
    },
    (error) => {
      // A bell that cannot load is not worth breaking a page over.
      console.error('Recent completions subscription error:', error);
      callback([]);
    }
  );
}

/**
 * Get all missions for a learner (one-time fetch)
 *
 * @param learnerId - Unique learner identifier (hashed before querying)
 * @returns Array of missions sorted by submission time (newest first)
 */
export async function getMissionsByLearnerId(
  learnerId: string
): Promise<Mission[]> {
  try {
    const learnerRef = await hashLearnerId(learnerId);
    const db = getFirestoreClient();
    const missionsRef = collection(db, 'missions');
    const q = query(
      missionsRef,
      where('learnerRef', '==', learnerRef),
      orderBy('submittedAt', 'desc'),
      limit(HISTORY_LIMIT)
    );

    const querySnapshot = await getDocs(q);

    const missions: Mission[] = [];
    querySnapshot.forEach((doc) => {
      const mission = convertTimestamps(doc.data() as Mission, doc.id);
      if (!mission.deleted) missions.push(mission);
    });

    return missions;
  } catch (error) {
    console.error('Failed to get missions by learnerId:', error);
    return [];
  }
}

/**
 * Convert Firestore Timestamps to ISO strings
 *
 * Firestore sometimes returns Timestamp objects instead of strings.
 * This helper ensures consistent date formatting.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore returns Timestamp|string for date fields; this bridges both shapes
function convertTimestamps(data: any, docId: string): Mission {
  const mission = { ...data, id: docId };

  if (mission.submittedAt instanceof Timestamp) {
    mission.submittedAt = mission.submittedAt.toDate().toISOString();
  }

  if (mission.startedAt instanceof Timestamp) {
    mission.startedAt = mission.startedAt.toDate().toISOString();
  }

  if (mission.completedAt instanceof Timestamp) {
    mission.completedAt = mission.completedAt.toDate().toISOString();
  }

  return mission as unknown as Mission;
}
