import 'server-only';

import { getFirebaseAdminAuth, getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { listOperatorAccounts } from '@/infrastructure/auth/operatorAccounts';
import { claimInvite, deleteInvite, listInvites, saveInvite } from '@/infrastructure/auth/operatorInvites';
import type { OperatorAccount, OperatorInvite, OperatorRole } from '@/core/domain/entities/OperatorAccount';
import type { IOperatorDirectory, OperatorIdentity } from '@/core/domain/repositories/IOperatorDirectory';
import { COLLECTIONS } from '@/infrastructure/persistence/collections';

/**
 * Operator access on Firebase.
 *
 *   Auth custom claim   role=operator|admin   the store everything enforces from
 *   users/{uid}         ledger only           who granted it, when, to whom
 *   operatorInvites     pending only          access for an address that has
 *                                             never signed in (see OperatorInvite)
 */
export class FirebaseOperatorDirectory implements IOperatorDirectory {
  listAccounts(): Promise<OperatorAccount[]> {
    return listOperatorAccounts();
  }

  listInvites(): Promise<OperatorInvite[]> {
    return listInvites();
  }

  async findByEmail(email: string): Promise<OperatorIdentity | null> {
    try {
      const user = await getFirebaseAdminAuth().getUserByEmail(email);
      return { uid: user.uid, email: user.email ?? null, claims: user.customClaims ?? {} };
    } catch (error) {
      // Operators sign in with Google, and their first sign-in creates the
      // account, so nobody being found is the ordinary case for a new one.
      if ((error as { code?: string }).code === 'auth/user-not-found') return null;
      throw error;
    }
  }

  async grant(identity: OperatorIdentity, role: OperatorRole, grantedBy: string): Promise<void> {
    await getFirebaseAdminAuth().setCustomUserClaims(identity.uid, { ...identity.claims, role });
    await this.ledger(identity.uid).set(
      { role, email: identity.email, grantedAt: new Date().toISOString(), grantedBy },
      { merge: true },
    );
  }

  async revoke(identity: OperatorIdentity, revokedBy: string): Promise<void> {
    const auth = getFirebaseAdminAuth();
    // Preserve unrelated claims rather than wiping the object.
    const { role: _removed, ...rest } = identity.claims;
    await auth.setCustomUserClaims(identity.uid, rest);
    await this.ledger(identity.uid).set(
      { role: null, revokedAt: new Date().toISOString(), revokedBy },
      { merge: true },
    );
    // dal.ts verifies with checkRevoked, so this takes effect on their very
    // next request rather than whenever the session happens to lapse.
    await auth.revokeRefreshTokens(identity.uid);
  }

  saveInvite(email: string, role: OperatorRole, invitedBy: string): Promise<void> {
    return saveInvite(email, role, invitedBy);
  }

  deleteInvite(email: string): Promise<boolean> {
    return deleteInvite(email);
  }

  claimInvite(uid: string, email: string): Promise<OperatorRole | null> {
    return claimInvite(uid, email);
  }

  private ledger(uid: string) {
    return getFirestoreInstance().collection(COLLECTIONS.users).doc(uid);
  }
}
