import 'server-only';

import { getFirebaseAdminAuth } from '@/infrastructure/persistence/firebase-admin';
import type { IOperatorAuth, VerifiedSignIn } from '@/core/domain/services/IOperatorAuth';

/** Operator sign-in on Firebase Auth. */
export class FirebaseOperatorAuth implements IOperatorAuth {
  async verifySignIn(idToken: string, { checkRevoked = true } = {}): Promise<VerifiedSignIn> {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken, checkRevoked);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      role: decoded.role,
      signedInAt: decoded.auth_time * 1000,
      provider: typeof decoded.firebase?.sign_in_provider === 'string' ? decoded.firebase.sign_in_provider : null,
    };
  }

  createSession(idToken: string, durationMs: number): Promise<string> {
    return getFirebaseAdminAuth().createSessionCookie(idToken, { expiresIn: durationMs });
  }

  async endSession(sessionCookie: string): Promise<void> {
    try {
      const auth = getFirebaseAdminAuth();
      const decoded = await auth.verifySessionCookie(sessionCookie, false);
      // dal.ts verifies with checkRevoked, so this takes effect immediately.
      await auth.revokeRefreshTokens(decoded.sub);
    } catch {
      // Already invalid.
    }
  }
}
