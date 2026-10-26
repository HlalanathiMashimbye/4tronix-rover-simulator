/**
 * A parent's sign-in, checked on the server before it links or restores a
 * learner. A recent sign-in only: an old token in a shared browser must not
 * be enough to take a child's profile.
 */
export type ParentSignInResult =
  | { ok: true; uid: string }
  | { ok: false; reason: 'stale' | 'invalid' };

export interface IParentSignIn {
  verifyRecent(idToken: string): Promise<ParentSignInResult>;
}
