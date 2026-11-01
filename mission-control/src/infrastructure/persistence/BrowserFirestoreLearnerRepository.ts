/**
 * Learner records on the browser's Firebase SDK, where Firestore rules apply.
 *
 * The rules allow exactly these writes: creating a record with the fields a
 * new learner has, and touching lastActiveAt and learnerRef on a visit. The
 * learner's email is not here at all: it lives in a subcollection only the
 * Admin SDK can reach, written by POST /api/learners/[id]/email.
 */

import { doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import type { Learner } from '@/core/domain/entities/Learner';
import type { ILearnerRepository } from '@/core/domain/repositories/ILearnerRepository';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';

const LEARNERS_COLLECTION = COLLECTIONS.learners;

export class BrowserFirestoreLearnerRepository implements ILearnerRepository {
  constructor(private readonly db: Firestore) {}

  async findById(id: string): Promise<Learner | null> {
    const snapshot = await getDoc(doc(this.db, LEARNERS_COLLECTION, id));
    return snapshot.exists() ? (snapshot.data() as Learner) : null;
  }

  async create(learner: Learner, learnerRef: string): Promise<void> {
    await setDoc(doc(this.db, LEARNERS_COLLECTION, learner.id), {
      ...learner,
      learnerRef,
      // The server's clock, not the browser's: a tablet with the wrong date
      // would otherwise stamp the record with it.
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    });
  }

  async recordVisit(id: string, learnerRef: string, at: string): Promise<void> {
    await updateDoc(doc(this.db, LEARNERS_COLLECTION, id), { lastActiveAt: at, learnerRef });
  }
}
