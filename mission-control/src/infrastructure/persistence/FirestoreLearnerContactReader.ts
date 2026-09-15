/**
 * Learner contact details, read from Firestore with the Admin SDK.
 *
 * Privileged by necessity: the address lives in a subcollection browsers are
 * denied outright (see learnerContact.ts), so only server code holding the
 * Admin SDK can reach it. Built in container.server.ts and nowhere else.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type {
  ILearnerContactReader,
  LearnerContact,
} from '@/core/domain/services/ILearnerContactReader';
import {
  LEARNER_PRIVATE_COLLECTION,
  LEARNER_CONTACT_DOC,
} from '@/core/domain/services/learnerContact';

const LEARNERS_COLLECTION = 'learners';

export class FirestoreLearnerContactReader implements ILearnerContactReader {
  constructor(private readonly firestore: Firestore) {}

  /**
   * Address and display name both come from the learner record, found by the
   * learnerRef the mission carries rather than by document id - the mission no
   * longer holds the raw id to look one up with.
   *
   * Previously the name was read from here while the address came off the
   * mission, and the learner record was written under a DIFFERENT id
   * (getOrCreateSession's sessionId, not getLearnerID's learnerId) - so this
   * lookup never hit and every email greeted "Space Explorer". Both now derive
   * from the same learnerRef, so they cannot drift apart again.
   */
  async findByLearnerRef(learnerRef: string): Promise<LearnerContact> {
    // Missions carry only a hash of the learner id, so the learner cannot be
    // fetched by document id any more - it is found by the matching learnerRef
    // field, which LearnerContext stamps onto the record. Single-field
    // equality, so Firestore's automatic index covers it.
    const matches = await this.firestore
      .collection(LEARNERS_COLLECTION)
      .where('learnerRef', '==', learnerRef)
      .limit(1)
      .get();

    if (matches.empty) {
      return {};
    }

    const learnerDoc = matches.docs[0].ref;
    const data = matches.docs[0].data();

    // The address lives in a browser-unreadable subcollection - see
    // learnerContact.ts for why it is not on the learner document.
    let email: string | undefined;
    try {
      const contactSnap = await learnerDoc
        .collection(LEARNER_PRIVATE_COLLECTION)
        .doc(LEARNER_CONTACT_DOC)
        .get();
      email = (contactSnap.data()?.learnerEmail as string) || undefined;
    } catch (error) {
      console.warn('[notify] Could not read learner contact record:', error);
    }

    // Fall back to the legacy field for learners who set an address before it
    // moved, and have not set one since. Those documents are cleaned up as
    // each learner next saves an address; drop this once none remain.
    if (!email) {
      email = (data?.learnerEmail as string) || undefined;
    }

    return {
      email,
      displayName: (data?.displayName as string) || undefined,
    };
  }
}
