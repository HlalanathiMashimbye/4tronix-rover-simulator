/**
 * Learner contact details, written with the Admin SDK into the subcollection
 * browsers are denied. Built in container.server.ts and nowhere else.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { ILearnerContactWriter } from '@/core/domain/services/ILearnerContactWriter';
import { LEARNER_CONTACT_DOC, LEARNER_PRIVATE_COLLECTION } from '@/core/domain/services/learnerContact';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';

export class FirestoreLearnerContactWriter implements ILearnerContactWriter {
  constructor(private readonly firestore: Firestore) {}

  async save(learnerId: string, email: string | null): Promise<void> {
    const learner = this.firestore.collection(COLLECTIONS.learners).doc(learnerId);
    const contact = learner.collection(LEARNER_PRIVATE_COLLECTION).doc(LEARNER_CONTACT_DOC);

    if (email === null) {
      await contact.delete();
    } else {
      await contact.set({ learnerEmail: email, updatedAt: new Date().toISOString() }, { merge: true });
    }

    // Clear any address left on the readable parent document by the old
    // client-side write. Without this, existing learners keep one there even
    // though nothing writes it any more.
    await learner.set({ learnerEmail: null }, { merge: true });
  }
}
