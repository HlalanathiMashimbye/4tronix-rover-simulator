/**
 * Granting and revoking operator access: the use case behind the team page.
 *
 * The route that serves the page used to hold all of this, Firebase calls
 * included, which made a 250-line controller do five jobs. It now validates
 * the request and maps the result to HTTP; the decisions are here, against
 * the IOperatorDirectory port, and the rules about which changes are allowed
 * at all stay on the OperatorAccount entity.
 *
 * Bootstrapping is deliberately not possible through this: every call needs
 * an admin to already exist. scripts/set-operator-role.mjs creates the first.
 */

import {
  changeBlocker,
  isNoOpChange,
  type OperatorAccount,
  type OperatorInvite,
  type OperatorRole,
} from '@/core/domain/entities/OperatorAccount';
import type { IOperatorDirectory } from '@/core/domain/repositories/IOperatorDirectory';

/** The admin making the change: their uid for the rules, and how the ledger names them. */
export interface TeamActor {
  uid: string;
  label: string;
}

export type TeamChange =
  | { outcome: 'changed' | 'unchanged' | 'invited' | 'invite-removed'; message: string }
  /** A rule on OperatorAccount refused it, such as removing the last admin. */
  | { outcome: 'blocked'; message: string }
  /** A revoke for an address with neither an account nor an invite. */
  | { outcome: 'nothing-to-revoke'; message: string };

/** A step that reached the directory failed. The message is the one the admin sees. */
export class TeamChangeFailed extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = 'TeamChangeFailed';
  }
}

/**
 * Tell someone they have been let in, true when the email went.
 *
 * Must not throw. The access is already written by the time it is called, and
 * an admin told "could not apply that change" over an email hiccup would
 * grant it twice.
 */
export type GrantAnnouncer = (to: string, role: OperatorRole) => Promise<boolean>;

export class OperatorTeamService {
  constructor(
    private readonly directory: IOperatorDirectory,
    private readonly announceGrant: GrantAnnouncer,
  ) {}

  async listing(): Promise<{ accounts: OperatorAccount[]; invites: OperatorInvite[] }> {
    const [accounts, invites] = await Promise.all([this.directory.listAccounts(), this.directory.listInvites()]);
    return { accounts, invites };
  }

  /** Give `email` this role, or take access away when `nextRole` is null. */
  async changeAccess(actor: TeamActor, email: string, nextRole: OperatorRole | null): Promise<TeamChange> {
    let identity;
    try {
      identity = await this.directory.findByEmail(email);
    } catch (cause) {
      throw new TeamChangeFailed('Could not look up that account', cause);
    }
    if (!identity) return this.changeInvite(actor, email, nextRole);

    const accounts = await this.directory.listAccounts();
    const change = { actorUid: actor.uid, targetUid: identity.uid, nextRole, accounts };

    const blocked = changeBlocker(change);
    if (blocked) return { outcome: 'blocked', message: blocked };

    const who = identity.email ?? identity.uid;
    if (isNoOpChange(change)) {
      // Not written: setting the claim and revoking tokens would sign the
      // person out to give them what they already had.
      return { outcome: 'unchanged', message: `${who} already has this access.` };
    }

    try {
      if (nextRole === null) {
        await this.directory.revoke(identity, actor.label);
      } else {
        await this.directory.grant(identity, nextRole, actor.label);
      }

      // Only a grant is announced. A removal is usually deliberate and is not
      // something to explain to the person by email.
      const emailed = nextRole !== null && identity.email ? await this.announceGrant(identity.email, nextRole) : false;

      // An invite for an address that has an account now is stale either way:
      // the change above is the decision, and a leftover invite would re-grant
      // a revoked role if this account were ever deleted and recreated.
      await this.directory.deleteInvite(email);

      return {
        outcome: 'changed',
        // Claims ride on the ID token, so a grant is not live until it
        // refreshes. Saying so prevents "it did not work" reports for
        // something working exactly as designed.
        message:
          nextRole === null
            ? `Access removed for ${who}. They have been signed out.`
            : `${who} is now ${nextRole}. ${emailed ? 'They have been emailed. ' : ''}They need to sign out and back in for it to take effect.`,
      };
    } catch (cause) {
      throw new TeamChangeFailed('Could not apply that change', cause);
    }
  }

  /**
   * Access for an address nobody has signed in with yet: kept as an invite and
   * applied by the session route on that address's first Google sign-in.
   */
  private async changeInvite(actor: TeamActor, email: string, nextRole: OperatorRole | null): Promise<TeamChange> {
    try {
      if (nextRole === null) {
        if (!(await this.directory.deleteInvite(email))) {
          return {
            outcome: 'nothing-to-revoke',
            message: `Nobody has access as ${email}, and there is no pending invite to remove.`,
          };
        }
        return { outcome: 'invite-removed', message: `Removed the pending access for ${email}.` };
      }

      await this.directory.saveInvite(email, nextRole, actor.label);
      const emailed = await this.announceGrant(email, nextRole);
      return {
        outcome: 'invited',
        message:
          `${email} has not signed in yet. They get ${nextRole} access the first time ` +
          'they sign in with Google using that address.' +
          (emailed ? ' They have been emailed.' : ''),
      };
    } catch (cause) {
      throw new TeamChangeFailed('Could not save that access', cause);
    }
  }
}
