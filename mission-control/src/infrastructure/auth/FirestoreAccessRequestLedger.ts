import 'server-only';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';
import type { AccessRequestEmail } from '@/core/domain/entities/OperatorAccount';
import type { IAccessRequestLedger, AccessRequestRecord } from '@/core/domain/repositories/IAccessRequestLedger';

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isSentEmail(value: unknown): value is AccessRequestEmail {
  const v = value as Partial<AccessRequestEmail> | null;
  return typeof v?.to === 'string' && typeof v.emailId === 'string' && v.emailId !== '';
}

function fromData(data: Record<string, unknown>): AccessRequestRecord {
  return {
    email: text(data.email),
    subject: text(data.subject),
    requestedAt: text(data.requestedAt),
    sent: Array.isArray(data.sent) ? data.sent.filter(isSentEmail) : [],
  };
}

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

  async find(uid: string): Promise<AccessRequestRecord | null> {
    const snapshot = await this.doc(uid).get();
    return snapshot.exists ? fromData(snapshot.data() ?? {}) : null;
  }

  async record(uid: string, email: string, subject: string, sent: AccessRequestEmail[], earlier: AccessRequestEmail[]): Promise<void> {
    await this.doc(uid).set({
      email,
      subject,
      requestedAt: new Date().toISOString(),
      sent: [...earlier, ...sent],
    });
  }

  async close(uid: string): Promise<AccessRequestRecord | null> {
    const ref = this.doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const record = fromData(snapshot.data() ?? {});
    await ref.delete();
    return record;
  }

  private doc(uid: string) {
    return getFirestoreInstance().collection(COLLECTIONS.operatorAccessRequests).doc(uid);
  }
}
