/**
 * Who may have an operator session, with no Firebase anywhere. The HTTP side
 * is covered in auth.session.api.test.ts.
 */

import { MAX_SIGN_IN_AGE_MS, OperatorSessionService } from '@/core/application/services/OperatorSessionService';
import type { IOperatorAuth, VerifiedSignIn } from '@/core/domain/services/IOperatorAuth';
import type { OperatorRole } from '@/core/domain/entities/OperatorAccount';

const NOW = 1_800_000_000_000;

function auth(signIn: Partial<VerifiedSignIn> | Error) {
  const ended: string[] = [];
  const fake: IOperatorAuth = {
    verifySignIn: async () => {
      if (signIn instanceof Error) throw signIn;
      return { uid: 'u1', email: 'thandi@rover.org', emailVerified: true, role: 'operator', signedInAt: NOW, provider: 'google.com', ...signIn };
    },
    createSession: async () => 'session-cookie',
    endSession: async (cookie) => void ended.push(cookie),
  };
  return { fake, ended };
}

type ClaimInvite = (uid: string, email: string) => Promise<OperatorRole | null>;

const service = (a: IOperatorAuth, claimInvite: ClaimInvite = async () => null) =>
  new OperatorSessionService(a, { claimInvite }, () => NOW);

it('gives an operator a session', async () => {
  expect(await service(auth({}).fake).signIn('t')).toEqual({ outcome: 'signed-in', role: 'operator', sessionCookie: 'session-cookie' });
});

it('refuses a sign-in older than the limit, so an old token cannot become a session', async () => {
  const stale = auth({ signedInAt: NOW - MAX_SIGN_IN_AGE_MS - 1 }).fake;
  expect((await service(stale).signIn('t')).outcome).toBe('stale');
});

it('applies a waiting invite on a first Google sign-in and asks for a fresh token', async () => {
  const claimInvite = jest.fn<Promise<OperatorRole | null>, [string, string]>(async () => 'operator');
  const result = await service(auth({ role: undefined }).fake, claimInvite).signIn('t');

  expect(result.outcome).toBe('access-granted');
  expect(claimInvite).toHaveBeenCalledWith('u1', 'thandi@rover.org');
});

it('does not claim an invite for an unverified address or a password sign-in', async () => {
  const claimInvite = jest.fn<Promise<OperatorRole | null>, [string, string]>(async () => 'operator');

  expect((await service(auth({ role: undefined, emailVerified: false }).fake, claimInvite).signIn('t')).outcome).toBe('no-access');
  expect((await service(auth({ role: undefined, provider: 'password' }).fake, claimInvite).signIn('t')).outcome).toBe('no-access');
  expect(claimInvite).not.toHaveBeenCalled();
});

it('names the account that has no access, and mints nothing', async () => {
  const a = auth({ role: 'learner' });
  const createSession = jest.spyOn(a.fake, 'createSession');

  expect(await service(a.fake).signIn('t')).toEqual({ outcome: 'no-access', email: 'thandi@rover.org' });
  expect(createSession).not.toHaveBeenCalled();
});

it('answers every unverifiable token the same way', async () => {
  expect((await service(auth(new Error('expired')).fake).signIn('t')).outcome).toBe('refused');
});

it('ends the session it is given, and does nothing without one', async () => {
  const a = auth({});
  await service(a.fake).signOut('cookie');
  await service(a.fake).signOut(undefined);

  expect(a.ended).toEqual(['cookie']);
});
