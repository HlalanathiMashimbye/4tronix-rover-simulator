import { Firestore } from 'firebase-admin/firestore';
import { IRecoveryCodeRepository } from '@/core/domain/repositories/IRecoveryCodeRepository';

const COLLECTION = 'recoveryCodes';

export class FirestoreRecoveryCodeRepository implements IRecoveryCodeRepository {
  constructor(private readonly db: Firestore) {}

  async storeCodeHash(learnerId: string, learnerRef: string, codeHash: string): Promise<void> {
    await this.db.collection(COLLECTION).doc(codeHash).set({
      learnerId,
      learnerRef,
      createdAt: new Date().toISOString(),
    });
  }

  async lookupByHash(codeHash: string): Promise<string | null> {
    const snap = await this.db.collection(COLLECTION).doc(codeHash).get();
    if (!snap.exists) return null;
    return (snap.data() as { learnerId: string }).learnerId;
  }

  async retireByLearnerRef(learnerRef: string): Promise<void> {
    const snapshot = await this.db
      .collection(COLLECTION)
      .where('learnerRef', '==', learnerRef)
      .get();

    if (snapshot.empty) return;

    const batch = this.db.batch();
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}
