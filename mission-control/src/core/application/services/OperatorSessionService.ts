/**
 * Signing an operator in and out: the use case behind /api/auth/session.
 *
 * The route used to hold this with the Admin SDK inline. It now validates the
 * request, checks the yard and sets cookies; who may have a session is
 * decided here, against the IOperatorAuth and IOperatorDirectory ports.
 */

import { inviteClaimant, isOperatorRole, type OperatorRole } from '@/core/domain/entities/OperatorAccount';
import type { IOperatorDirectory } from '@/core/domain/repositories/IOperatorDirectory';
import type { IOperatorAuth } from '@/core/domain/services/IOperatorAuth';

/** Long enough to cover an event day, so nobody is signed out mid-session. */
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * Firebase's guidance: only mint a session from a RECENT sign-in, so a token
 * that is still valid but old cannot be turned into a 12-hour session.
 */
export const MAX_SIGN_IN_AGE_MS = 5 * 60 * 1000;

export type SignInOutcome =
  | { outcome: 'signed-in'; role: OperatorRole; sessionCookie: string }
  /** The sign-in is too old to mint a session from. */
  | { outcome: 'stale' }
  /** An invite was waiting and is now applied; the browser fetches a fresh token and retries. */
  | { outcome: 'access-granted' }
  /** A real account with no operator role. Named, so the admin knows which address to add. */
  | { outcome: 'no-access'; email: string | null }
  /** Expired, revoked, malformed or for another project. One answer for all of them. */
  | { outcome: 'refused'; reason: string };

export class OperatorSessionService {
  constructor(
    private readonly auth: IOperatorAuth,
    private readonly directory: Pick<IOperatorDirectory, 'claimInvite'>,
    private readonly now: () => number = Date.now,
  ) {}

  async signIn(idToken: string): Promise<SignInOutcome> {
    try {
      const signIn = await this.auth.verifySignIn(idToken, { checkRevoked: true });

      if (this.now() - signIn.signedInAt > MAX_SIGN_IN_AGE_MS) return { outcome: 'stale' };

      // Refused before minting anything. dal.ts would reject a session with
      // no role anyway, but a cookie that can never work turns "you do not
      // have access" into a silent redirect loop.
      if (!isOperatorRole(signIn.role)) {
        // A first Google sign-in has no role yet: the account did not exist
        // until a moment ago. If an admin invited this address, the role is
        // written now, after the token in hand was minted.
        const claimant = inviteClaimant({
          email: signIn.email,
          email_verified: signIn.emailVerified,
          firebase: { sign_in_provider: signIn.provider },
        });
        if (claimant && (await this.directory.claimInvite(signIn.uid, claimant))) {
          return { outcome: 'access-granted' };
        }
        return { outcome: 'no-access', email: signIn.email };
      }

      const sessionCookie = await this.auth.createSession(idToken, SESSION_DURATION_MS);
      return { outcome: 'signed-in', role: signIn.role, sessionCookie };
    } catch (error) {
      return { outcome: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async signOut(sessionCookie: string | undefined): Promise<void> {
    if (sessionCookie) await this.auth.endSession(sessionCookie);
  }
}
