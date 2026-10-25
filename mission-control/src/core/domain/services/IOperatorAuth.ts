/**
 * The identity provider, as the operator sign-in sees it.
 *
 * The session and access-request routes called the Firebase Admin SDK
 * themselves, so the rules about who may sign in sat in controllers next to
 * the SDK calls. This is the port those calls sit behind now;
 * FirebaseOperatorAuth implements it.
 */

/** A sign-in the provider has vouched for. */
export interface VerifiedSignIn {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** The role claim as stored. Not trusted to be a role until checked. */
  role: unknown;
  /** When the person actually signed in, in milliseconds. */
  signedInAt: number;
  /** How they signed in, such as google.com. */
  provider: string | null;
}

export interface IOperatorAuth {
  /** Throws when the token is expired, revoked, malformed or for another project. */
  verifySignIn(idToken: string, options?: { checkRevoked?: boolean }): Promise<VerifiedSignIn>;

  /** A session cookie for a verified sign-in, lasting `durationMs`. */
  createSession(idToken: string, durationMs: number): Promise<string>;

  /**
   * End the session everywhere, not just in this browser. Never throws: a
   * session that cannot be verified is already as ended as it gets.
   */
  endSession(sessionCookie: string): Promise<void>;
}
