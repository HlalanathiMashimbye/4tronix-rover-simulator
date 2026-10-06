/**
 * Who holds operator access, and the rules about changing it.
 *
 * Roles live on the Firebase Auth custom claim, which is the single store that
 * firestore.rules, lib/auth/dal.ts and the yard console all read. This module
 * holds no infrastructure: it is the decision logic, so the rule that stops an
 * admin locking everyone out is testable without a Firebase project.
 */

export type OperatorRole = 'operator' | 'admin';

export interface OperatorAccount {
  uid: string;
  email: string | null;
  role: OperatorRole;
  /** From the users/{uid} ledger. Audit trail only; nothing enforces from it. */
  grantedAt?: string | null;
  grantedBy?: string | null;
}

export function isOperatorRole(value: unknown): value is OperatorRole {
  return value === 'operator' || value === 'admin';
}

/** A change to one account's role. `null` means revoke access entirely. */
export interface RoleChange {
  actorUid: string;
  targetUid: string;
  nextRole: OperatorRole | null;
  accounts: OperatorAccount[];
}

/**
 * Why this change must be refused, or null if it may proceed.
 *
 * Returns the message the admin actually sees, rather than a code, because
 * every one of these is a sentence explaining a consequence they cannot
 * otherwise know.
 */
export function changeBlocker({
  actorUid,
  targetUid,
  nextRole,
  accounts,
}: RoleChange): string | null {
  const target = accounts.find((a) => a.uid === targetUid);

  // Demoting or revoking yourself. Always refused, and it never blocks an
  // achievable outcome: another admin can do it for you, and if there is no
  // other admin then the rule below refuses it anyway. What it does prevent is
  // an admin removing their own access mid-event by misreading a row.
  if (targetUid === actorUid && nextRole !== 'admin') {
    return 'You cannot remove your own admin access. Ask another admin to do it.';
  }

  // The lockout rule, and the reason this page can exist at all.
  //
  // Admin is the only tier that can grant access. Take the last one away and
  // there is no way back through the app: recovering means a service-account
  // key, a laptop and scripts/set-operator-role.mjs, which is precisely the
  // dependency this page was built to remove.
  if (target?.role === 'admin' && nextRole !== 'admin') {
    const remainingAdmins = accounts.filter(
      (a) => a.role === 'admin' && a.uid !== targetUid,
    ).length;

    if (remainingAdmins === 0) {
      return (
        'This is the only admin account. Removing it would leave nobody able ' +
        'to grant access, and recovering would mean running a script against ' +
        'the database. Promote someone else to admin first.'
      );
    }
  }

  return null;
}

/**
 * True when a grant would change nothing.
 *
 * Worth reporting rather than writing: a no-op grant still rotates the account's
 * refresh tokens, which signs the person out for no reason.
 */
export function isNoOpChange({ targetUid, nextRole, accounts }: RoleChange): boolean {
  const target = accounts.find((a) => a.uid === targetUid);
  return (target?.role ?? null) === nextRole;
}

/** Admins first, then by email, so the list reads the same way every time. */
export function sortAccounts(accounts: OperatorAccount[]): OperatorAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return (a.email ?? a.uid).localeCompare(b.email ?? b.uid);
  });
}

/**
 * Access granted to an email address nobody has signed in with yet.
 *
 * WHY THIS EXISTS. Operators sign in with Google, and a person's first Google
 * sign-in is what creates their Firebase account. Roles are granted to an
 * account, so without this an admin could not give anyone access until that
 * person had already tried, failed, and come back: "sign in, get refused, wait
 * for me, sign in again" as the onboarding for every facilitator.
 *
 * An invite is not access. Nothing enforces from it; it becomes the role claim
 * the first time a matching, Google-verified address signs in, and is then
 * deleted. It is kept apart from OperatorAccount on purpose, so a pending
 * admin can never count towards the "last admin" rule above: an invite nobody
 * has claimed cannot grant anyone else access.
 */
export interface OperatorInvite {
  email: string;
  role: OperatorRole;
  invitedAt: string | null;
  invitedBy: string | null;
}

/**
 * The one spelling of an email this system stores and compares.
 *
 * Firebase lowercases the addresses it holds, and people do not: an admin who
 * types Thandi@Example.org must still match the thandi@example.org Google
 * reports, or the invite silently never applies.
 */
export function inviteKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The parts of a verified ID token that decide whether it may claim an invite. */
export interface InviteClaimToken {
  email?: unknown;
  email_verified?: unknown;
  firebase?: { sign_in_provider?: unknown };
}

/**
 * The email this sign-in may claim an invite for, or null.
 *
 * Only a Google sign-in, and only when Google says it verified the address.
 * An invite is addressed to an email, so whoever proves they own that email
 * is who it was for. A password account proves nothing about the address: an
 * account created as somebody else's email, before they ever arrived, would
 * otherwise collect the access an admin meant for them.
 */
export function inviteClaimant(token: InviteClaimToken): string | null {
  if (token.firebase?.sign_in_provider !== 'google.com') return null;
  if (token.email_verified !== true) return null;
  if (typeof token.email !== 'string' || !token.email.trim()) return null;
  return inviteKey(token.email);
}

/** Newest first: the invite an admin just sent is the one they look for. */
export function sortInvites(invites: OperatorInvite[]): OperatorInvite[] {
  return [...invites].sort((a, b) => (b.invitedAt ?? '').localeCompare(a.invitedAt ?? ''));
}
