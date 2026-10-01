import 'server-only';

import { getFirebaseAdminAuth, getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import {
  inviteKey,
  isOperatorRole,
  sortInvites,
  type OperatorInvite,
  type OperatorRole,
} from '@/core/domain/entities/OperatorAccount';

/**
 * Access waiting for someone's first sign-in. See OperatorInvite for why.
 *
 *   operatorInvites/{email}   role, invitedAt, invitedBy
 *
 * Server-only. firestore.rules has no match for this collection, and Firestore
 * denies whatever is not matched, so no browser can read who is about to be
 * given access or write itself an invite.
 */
const COLLECTION = 'operatorInvites';

export async function listInvites(): Promise<OperatorInvite[]> {
  const snapshot = await getFirestoreInstance().collection(COLLECTION).get();
  const invites: OperatorInvite[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!isOperatorRole(data.role)) continue;
    invites.push({
      email: doc.id,
      role: data.role,
      invitedAt: data.invitedAt ?? null,
      invitedBy: data.invitedBy ?? null,
    });
  }
  return sortInvites(invites);
}

export async function saveInvite(email: string, role: OperatorRole, invitedBy: string): Promise<void> {
  await getFirestoreInstance().collection(COLLECTION).doc(inviteKey(email)).set({
    role,
    invitedAt: new Date().toISOString(),
    invitedBy,
  });
}

/** Removes a pending invite. True if there was one to remove. */
export async function deleteInvite(email: string): Promise<boolean> {
  const ref = getFirestoreInstance().collection(COLLECTION).doc(inviteKey(email));
  const existing = await ref.get();
  if (!existing.exists) return false;
  await ref.delete();
  return true;
}

/**
 * Turn the invite for this email into the account's role claim.
 *
 * Returns the role granted, or null when there is no invite. The caller must
 * already have checked the sign-in is allowed to claim it (inviteClaimant).
 *
 * ORDER MATTERS. The claim is written before the invite is deleted, so a
 * failure part-way leaves the invite in place and the next sign-in finishes
 * the job. The other order could lose the grant entirely: invite gone, claim
 * never written, and an admin told the person was given access.
 */
export async function claimInvite(uid: string, email: string): Promise<OperatorRole | null> {
  const db = getFirestoreInstance();
  const ref = db.collection(COLLECTION).doc(inviteKey(email));
  const invite = await ref.get();
  if (!invite.exists) return null;

  const data = invite.data() ?? {};
  if (!isOperatorRole(data.role)) return null;
  const role = data.role;

  const auth = getFirebaseAdminAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(user.customClaims ?? {}), role });

  // The same ledger the team page writes, so an account that arrived by
  // invite reads "granted by" whoever invited it, like any other.
  await db.collection('users').doc(uid).set(
    {
      role,
      email: inviteKey(email),
      grantedAt: data.invitedAt ?? new Date().toISOString(),
      grantedBy: data.invitedBy ?? null,
      claimedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await ref.delete();
  return role;
}
