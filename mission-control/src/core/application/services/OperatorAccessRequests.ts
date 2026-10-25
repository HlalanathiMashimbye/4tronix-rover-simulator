/**
 * Someone signed in with Google and has no operator access: ask the admins.
 *
 * The use case behind /api/auth/access-request. The address in the email is
 * the one the identity provider verified, never one typed into a form, so
 * nobody can ask in somebody else's name. Nothing is granted here: the email
 * links to Manage access and the admin decides.
 */

import { isOperatorRole } from '@/core/domain/entities/OperatorAccount';
import type { IAccessRequestLedger } from '@/core/domain/repositories/IAccessRequestLedger';
import type { IOperatorDirectory } from '@/core/domain/repositories/IOperatorDirectory';
import type { IOperatorAuth } from '@/core/domain/services/IOperatorAuth';

export const ACCESS_REQUEST_INTERVAL_MS = 60 * 60 * 1000;

/** Email each admin about `requester`, and say how many emails went. */
export type AdminNotifier = (adminEmails: string[], requester: string) => Promise<number>;

export type AccessRequestOutcome =
  | { outcome: 'sent'; notified: number }
  /** Asked within the hour: answered as success without sending again. */
  | { outcome: 'already-asked' }
  | { outcome: 'signed-out' }
  | { outcome: 'has-access' }
  /** No verified address: an unverified one could be anyone's. */
  | { outcome: 'unverified' }
  | { outcome: 'no-admin' }
  | { outcome: 'undelivered' };

export class OperatorAccessRequests {
  constructor(
    private readonly auth: IOperatorAuth,
    private readonly directory: Pick<IOperatorDirectory, 'listAccounts'>,
    private readonly ledger: IAccessRequestLedger,
    private readonly notifyAdmins: AdminNotifier,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws when the ledger, the account list or the notifier fails outright. */
  async request(idToken: string): Promise<AccessRequestOutcome> {
    let signIn;
    try {
      signIn = await this.auth.verifySignIn(idToken, { checkRevoked: false });
    } catch {
      return { outcome: 'signed-out' };
    }

    if (isOperatorRole(signIn.role)) return { outcome: 'has-access' };
    if (!signIn.email || !signIn.emailVerified) return { outcome: 'unverified' };

    const lastAt = await this.ledger.lastRequestedAt(signIn.uid);
    if (lastAt !== null && this.now() - lastAt < ACCESS_REQUEST_INTERVAL_MS) {
      return { outcome: 'already-asked' };
    }

    const admins = (await this.directory.listAccounts())
      .filter((a) => a.role === 'admin' && a.email)
      .map((a) => a.email!);
    if (admins.length === 0) return { outcome: 'no-admin' };

    const delivered = await this.notifyAdmins(admins, signIn.email);
    if (delivered === 0) return { outcome: 'undelivered' };

    await this.ledger.record(signIn.uid, signIn.email, delivered);
    return { outcome: 'sent', notified: delivered };
  }
}
