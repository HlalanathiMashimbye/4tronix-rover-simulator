import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { IParentLinkRepository } from '@/core/domain/repositories/IParentLinkRepository';
import {
  LEARNER_PRIVATE_COLLECTION,
  PARENT_LINK_DOC,
  PARENT_LINKS_COLLECTION,
} from '@/core/domain/services/parentLink';

const LEARNERS_COLLECTION = 'learners';

export class FirestoreParentLinkRepository implements IParentLinkRepository {
  constructor(private readonly db: Firestore) {}

  async link(learnerId: string, parentUid: string, consentVersion: number): Promise<void> {
    const batch = this.db.batch();

    batch.set(
      this.db
        .collection(LEARNERS_COLLECTION)
        .doc(learnerId)
        .collection(LEARNER_PRIVATE_COLLECTION)
        .doc(PARENT_LINK_DOC),
      {
        parentUid,
        consentedAt: new Date().toISOString(),
        consentVersion,
      },
    );

    batch.set(
      this.db.collection(PARENT_LINKS_COLLECTION).doc(parentUid),
      { learnerIds: FieldValue.arrayUnion(learnerId) },
      { merge: true },
    );

    await batch.commit();
  }

  async unlink(learnerId: string, parentUid: string): Promise<void> {
    const batch = this.db.batch();

    batch.delete(
      this.db
        .collection(LEARNERS_COLLECTION)
        .doc(learnerId)
        .collection(LEARNER_PRIVATE_COLLECTION)
        .doc(PARENT_LINK_DOC),
    );

    const parentRef = this.db.collection(PARENT_LINKS_COLLECTION).doc(parentUid);
    const parentSnap = await parentRef.get();
    const learnerIds: string[] = (parentSnap.data()?.learnerIds as string[]) ?? [];

    if (learnerIds.length <= 1) {
      batch.delete(parentRef);
    } else {
      batch.update(parentRef, { learnerIds: FieldValue.arrayRemove(learnerId) });
    }

    await batch.commit();
  }

  async findByLearnerId(
    learnerId: string,
  ): Promise<{ parentUid: string; consentVersion: number } | null> {
    const snap = await this.db
      .collection(LEARNERS_COLLECTION)
      .doc(learnerId)
      .collection(LEARNER_PRIVATE_COLLECTION)
      .doc(PARENT_LINK_DOC)
      .get();

    if (!snap.exists) return null;

    const data = snap.data() as { parentUid: string; consentVersion: number };
    return { parentUid: data.parentUid, consentVersion: data.consentVersion };
  }

  async findByParentUid(parentUid: string): Promise<string[]> {
    const snap = await this.db.collection(PARENT_LINKS_COLLECTION).doc(parentUid).get();
    if (!snap.exists) return [];
    return (snap.data()?.learnerIds as string[]) ?? [];
  }
}
