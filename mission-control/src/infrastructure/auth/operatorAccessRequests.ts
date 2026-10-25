import 'server-only';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import type { AccessRequestEmail } from '@/core/domain/entities/OperatorAccount';

/**
 * Someone asking for operator access, from the moment the admins are emailed
 * until one of them grants it.
 *
 *   operatorAccessRequests/{uid}   email, subject, requestedAt, sent[]
 *
 * Server-only, like operatorInvites: firestore.rules has no match for this
 * collection, so no browser can read who is asking or write itself a request.
 *
 * It started as the once-an-hour limit alone. `sent` is what makes it more:
 * the id of every email the request went out as, so that granting the access
 * can reply to each one and every admin sees it answered in the same thread.
 */
const COLLECTION = 'operatorAccessRequests';

export interface AccessRequest {
  email: string | null;
  subject: string | null;
  requestedAt: string | null;
  sent: AccessRequestEmail[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isSentEmail(value: unknown): value is AccessRequestEmail {
  const v = value as Partial<AccessRequestEmail> | null;
  return typeof v?.to === 'string' && typeof v.emailId === 'string' && v.emailId !== '';
}

function fromData(data: Record<string, unknown>): AccessRequest {
  return {
    email: text(data.email),
    subject: text(data.subject),
    requestedAt: text(data.requestedAt),
    // A request recorded before replies existed has no `sent`, and so nothing
    // a reply could answer.
    sent: Array.isArray(data.sent) ? data.sent.filter(isSentEmail) : [],
  };
}

function requestRef(uid: string) {
  return getFirestoreInstance().collection(COLLECTION).doc(uid);
}

export async function findAccessRequest(uid: string): Promise<AccessRequest | null> {
  const snapshot = await requestRef(uid).get();
  return snapshot.exists ? fromData(snapshot.data() ?? {}) : null;
}

/**
 * The emails already sent for this request are kept, not replaced. Someone who
 * asks again once the hour is up is in each admin's inbox twice, and the reply
 * that closes the request has to answer both.
 */
export async function recordAccessRequest(
  uid: string,
  latest: { email: string; subject: string; sent: AccessRequestEmail[] },
  earlier: AccessRequest | null,
): Promise<void> {
  await requestRef(uid).set({
    email: latest.email,
    subject: latest.subject,
    requestedAt: new Date().toISOString(),
    sent: [...(earlier?.sent ?? []), ...latest.sent],
  });
}

/**
 * Ends the request and returns it, or null if there was none.
 *
 * Deleted rather than marked done. The person has access now, and if it is
 * ever taken away and they ask again, that is a new request with new emails;
 * a reply to it must not answer these as well.
 */
export async function closeAccessRequest(uid: string): Promise<AccessRequest | null> {
  const ref = requestRef(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const request = fromData(snapshot.data() ?? {});
  await ref.delete();
  return request;
}
