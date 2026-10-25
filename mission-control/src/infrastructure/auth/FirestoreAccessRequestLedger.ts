import 'server-only';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';
import type { IAccessRequestLedger } from '@/core/domain/repositories/IAccessRequestLedger';

/**
 * operatorAccessRequests/{uid}. Server-only: firestore.rules matches nothing
 * there, so it is denied to browsers.
 */
export class FirestoreAccessRequestLedger implements IAccessRequestLedger {
  async lastRequestedAt(uid: string): Promise<number | null> {
    const previous = await this.doc(uid).get();
    const at = previous.exists ? Date.parse(previous.data()?.requestedAt ?? '') : NaN;
    return Number.isNaN(at) ? null : at;
  }

  async record(uid: string, email: string, notified: number): Promise<void> {
    await this.doc(uid).set({ email, requestedAt: new Date().toISOString(), notified });
  }

  private doc(uid: string) {
    return getFirestoreInstance().collection(COLLECTIONS.operatorAccessRequests).doc(uid);
  }
}
