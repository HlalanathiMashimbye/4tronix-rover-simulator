/**
 * A parent's sign-in links or restores a child's profile only while it is
 * fresh: a token left in a shared browser must not be enough.
 */

import type { Auth } from 'firebase-admin/auth';

import { FirebaseParentSignIn, MAX_SIGN_IN_AGE_MS } from '@/infrastructure/auth/FirebaseParentSignIn';

const NOW = Date.parse('2026-10-26T09:00:00Z');

function signIn(verify: () => Promise<unknown>) {
  return new FirebaseParentSignIn({ verifyIdToken: jest.fn(verify) } as unknown as Auth, () => NOW);
}

it('accepts a sign-in made within five minutes, and names the parent', async () => {
  const recent = signIn(async () => ({ uid: 'parent-1', auth_time: (NOW - MAX_SIGN_IN_AGE_MS + 1000) / 1000 }));

  expect(await recent.verifyRecent('token')).toEqual({ ok: true, uid: 'parent-1' });
});

it('refuses an older sign-in as stale', async () => {
  const old = signIn(async () => ({ uid: 'parent-1', auth_time: (NOW - MAX_SIGN_IN_AGE_MS - 1000) / 1000 }));

  expect(await old.verifyRecent('token')).toEqual({ ok: false, reason: 'stale' });
});

it('refuses a token Firebase rejects as invalid', async () => {
  const bad = signIn(async () => { throw new Error('revoked'); });

  expect(await bad.verifyRecent('token')).toEqual({ ok: false, reason: 'invalid' });
});
