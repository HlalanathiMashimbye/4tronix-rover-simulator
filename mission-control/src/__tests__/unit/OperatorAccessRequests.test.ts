/**
 * "Ask an admin", with no Firebase anywhere. The HTTP side is covered in
 * auth.accessRequest.api.test.ts.
 */

import { ACCESS_REQUEST_INTERVAL_MS, OperatorAccessRequests } from '@/core/application/services/OperatorAccessRequests';
import type { OperatorAccount } from '@/core/domain/entities/OperatorAccount';
import type { IOperatorAuth, VerifiedSignIn } from '@/core/domain/services/IOperatorAuth';

const NOW = 1_800_000_000_000;
const ADMIN: OperatorAccount = { uid: 'a1', email: 'admin@rover.org', role: 'admin' };

function setUp({ signIn = {}, accounts = [ADMIN], lastAt = null as number | null, delivered = 1 }: {
  signIn?: Partial<VerifiedSignIn> | Error; accounts?: OperatorAccount[]; lastAt?: number | null; delivered?: number;
} = {}) {
  const recorded: Array<[string, string, number]> = [];
  const notify = jest.fn(async () => delivered);
  const auth: IOperatorAuth = {
    verifySignIn: async () => {
      if (signIn instanceof Error) throw signIn;
      return { uid: 'u1', email: 'new@rover.org', emailVerified: true, role: undefined, signedInAt: NOW, provider: 'google.com', ...signIn };
    },
    createSession: async () => '',
    endSession: async () => {},
  };
  const requests = new OperatorAccessRequests(
    auth,
    { listAccounts: async () => accounts },
    { lastRequestedAt: async () => lastAt, record: async (...r) => void recorded.push(r) },
    notify,
    () => NOW,
  );
  return { requests, notify, recorded };
}

it('emails every admin with the verified address and records that it asked', async () => {
  const { requests, notify, recorded } = setUp({ accounts: [ADMIN, { uid: 'o1', email: 'op@rover.org', role: 'operator' }] });

  expect(await requests.request('t')).toEqual({ outcome: 'sent', notified: 1 });
  expect(notify).toHaveBeenCalledWith(['admin@rover.org'], 'new@rover.org');
  expect(recorded).toEqual([['u1', 'new@rover.org', 1]]);
});

it('answers a second request within the hour without emailing again', async () => {
  const { requests, notify } = setUp({ lastAt: NOW - ACCESS_REQUEST_INTERVAL_MS + 1000 });

  expect((await requests.request('t')).outcome).toBe('already-asked');
  expect(notify).not.toHaveBeenCalled();
});

it('asks again once the hour is up', async () => {
  expect((await setUp({ lastAt: NOW - ACCESS_REQUEST_INTERVAL_MS - 1 }).requests.request('t')).outcome).toBe('sent');
});

it('puts no unverified address in front of an admin', async () => {
  const { requests, notify } = setUp({ signIn: { emailVerified: false } });

  expect((await requests.request('t')).outcome).toBe('unverified');
  expect(notify).not.toHaveBeenCalled();
});

it.each([
  ['an account that already has access', { signIn: { role: 'operator' } }, 'has-access'],
  ['a token that does not verify', { signIn: new Error('expired') }, 'signed-out'],
  ['a yard with no admin yet', { accounts: [] }, 'no-admin'],
  ['emails that all fail', { delivered: 0 }, 'undelivered'],
] as const)('says so for %s', async (_case, options, outcome) => {
  expect((await setUp(options as never).requests.request('t')).outcome).toBe(outcome);
});

it('records nothing when no email went, so they can ask again straight away', async () => {
  const { requests, recorded } = setUp({ delivered: 0 });
  await requests.request('t');
  expect(recorded).toEqual([]);
});
