/**
 * Who holds operator access, and the one place it can be changed.
 *
 * The team route used to call the Firebase Admin SDK itself: claims, the
 * ledger, token revocation and the invite store, all inline in a controller.
 * This is the port that work sits behind, so the rules about when to grant,
 * invite or refuse (OperatorTeamService) are testable without Firebase.
 */

import type { OperatorAccount, OperatorInvite, OperatorRole } from '../entities/OperatorAccount';

/** An account found by address, with the claims a change must preserve. */
export interface OperatorIdentity {
  uid: string;
  email: string | null;
  claims: Record<string, unknown>;
}

export interface IOperatorDirectory {
  /** Everyone holding a role, from the store access is enforced from. */
  listAccounts(): Promise<OperatorAccount[]>;
  listInvites(): Promise<OperatorInvite[]>;

  /** The account signed in with this address, or null when nobody has yet. */
  findByEmail(email: string): Promise<OperatorIdentity | null>;

  /** Give the account this role, keeping its other claims, and record who did it. */
  grant(identity: OperatorIdentity, role: OperatorRole, grantedBy: string): Promise<void>;

  /** Take the role away and sign the account out now, not when its session lapses. */
  revoke(identity: OperatorIdentity, revokedBy: string): Promise<void>;

  /** Hold a role for an address until its first sign-in. */
  saveInvite(email: string, role: OperatorRole, invitedBy: string): Promise<void>;

  /** True when there was an invite to remove. */
  deleteInvite(email: string): Promise<boolean>;

  /**
   * Turn a waiting invite into the account's role on its first sign-in. The
   * role granted, or null when there is no invite. The caller must already
   * know the sign-in may claim it (inviteClaimant).
   */
  claimInvite(uid: string, email: string): Promise<OperatorRole | null>;
}
