/**
 * Missions on the browser's Firebase SDK, where Firestore rules apply.
 *
 * Reads are inherited from FirestoreMissionReader. The one write is the email
 * stamp the rules allow a visitor; every other write is refused by the rules,
 * and this class has no method that could attempt one.
 */

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { ILearnerEmailStamp, MissionCursor } from '@/core/domain/repositories/IMissionRepository';
import { FirestoreMissionReader } from './FirestoreMissionReader';
import {
  MISSIONS_COLLECTION,
  RUNS_SUBCOLLECTION,
  type DocumentLike,
  type MissionDocData,
} from './missionDocuments';

export class BrowserFirestoreMissionReader extends FirestoreMissionReader implements ILearnerEmailStamp {
  constructor(private readonly db: Firestore) {
    super();
  }

  async stampLearnerEmailHash(missionId: string, emailHash: string): Promise<boolean> {
    const missionRef = doc(this.db, MISSIONS_COLLECTION, missionId);
    const snapshot = await getDoc(missionRef);
    // Already stamped, say by the learner re-saving the same address: its
    // queued email has gone, and stamping again would send it twice.
    if (!snapshot.exists() || snapshot.data().learnerEmailHash) return false;

    await updateDoc(missionRef, { learnerEmailHash: emailHash });
    return true;
  }

  protected async readMission(id: string): Promise<MissionDocData | null> {
    const snapshot = await getDoc(doc(this.db, MISSIONS_COLLECTION, id));
    return snapshot.exists() ? (snapshot.data() as MissionDocData) : null;
  }

  protected async readIdRange(start: string, end: string, max: number): Promise<DocumentLike[]> {
    const snapshot = await getDocs(query(
      collection(this.db, MISSIONS_COLLECTION),
      where(documentId(), '>=', start),
      where(documentId(), '<', end),
      limit(max),
    ));
    return snapshot.docs;
  }

  protected async readRecent(max: number, cursor?: MissionCursor): Promise<DocumentLike[]> {
    const snapshot = await getDocs(query(
      collection(this.db, MISSIONS_COLLECTION),
      orderBy('submittedAt', 'desc'),
      orderBy('__name__', 'desc'),
      ...(cursor ? [startAfter(cursor.submittedAt, cursor.id)] : []),
      limit(max),
    ));
    return snapshot.docs;
  }

  protected async readRuns(missionId: string): Promise<DocumentLike[]> {
    const snapshot = await getDocs(collection(this.db, MISSIONS_COLLECTION, missionId, RUNS_SUBCOLLECTION));
    return snapshot.docs;
  }
}
