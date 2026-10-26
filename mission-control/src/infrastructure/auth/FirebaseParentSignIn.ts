import type { Auth } from 'firebase-admin/auth';

import type { IParentSignIn, ParentSignInResult } from '@/core/domain/services/IParentSignIn';

/** Five minutes: long enough to finish the flow, short enough that a token left in a shared browser is no use. */
export const MAX_SIGN_IN_AGE_MS = 5 * 60 * 1000;

export class FirebaseParentSignIn implements IParentSignIn {
  constructor(private readonly auth: Auth, private readonly now: () => number = Date.now) {}

  async verifyRecent(idToken: string): Promise<ParentSignInResult> {
    let decoded;
    try {
      decoded = await this.auth.verifyIdToken(idToken, true);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    if (this.now() - decoded.auth_time * 1000 > MAX_SIGN_IN_AGE_MS) return { ok: false, reason: 'stale' };
    return { ok: true, uid: decoded.uid };
  }
}
