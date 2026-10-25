/**
 * "Ask an admin", with no Firebase anywhere. The HTTP side is covered in
 * auth.accessRequest.api.test.ts.
 */

import { ACCESS_REQUEST_INTERVAL_MS, OperatorAccessRequests } from '@/core/application/services/OperatorAccessRequests';
import type { OperatorAccount, AccessRequestEmail } from '@/core/domain/entities/OperatorAccount';
import type { IOperatorAuth, VerifiedSignIn } from '@/core/domain/services/IOperatorAuth';
import type { IAccessRequestLedger, AccessRequestRecord } from '@/core/domain/repositories/IAccessRequestLedger';

const NOW = 1_800_000_000_000;
const ADMIN: OperatorAccount = { uid: 'a1', email: 'admin@rover.org', role: 'admin' };
const SUBJECT = 'new@rover.org is asking for operator access';

function setUp({ signIn = {}, accounts = [ADMIN], existing = null as AccessRequestRecord | null, delivered = 1 }: {
  signIn?: Partial<VerifiedSignIn> | Error; accounts?: OperatorAccount[]; existing?: AccessRequestRecord | null; delivered?: number;
} = {}) {
  const recorded: Array<{ uid: string; email: string; subject: string; sent: AccessRequestEmail[]; earlier: AccessRequestEmail[] }> = [];
  const notify = jest.fn(async () => ({
    subject: SUBJECT,
    sent: delivered > 0 ? [{ to: 'admin@rover.org', emailId: 'id-1' }].slice(0, delivered) : [] as AccessRequestEmail[],
  }));
  const auth: IOperatorAuth = {
    verifySignIn: async () => {
      if (signIn instanceof Error) throw signIn;
      return { uid: 'u1', email: 'new@rover.org', emailVerified: true, role: undefined, signedInAt: NOW, provider: 'google.com', ...signIn };
    },
    createSession: async () => '',
    endSession: async () => {},
  };
  const ledger: IAccessRequestLedger = {
    lastRequestedAt: async () => existing?.requestedAt ? Date.parse(existing.requestedAt) : null,
    find: async () => existing,
    record: async (uid, email, subject, sent, earlier) => void recorded.push({ uid, email, subject, sent, earlier }),
    close: async () => null,
  };
  const requests = new OperatorAccessRequests(
    auth,
    { listAccounts: async () => accounts },
    ledger,
    notify,
    () => NOW,
  );
  return { requests, notify, recorded };
}

it('emails every admin with the verified address and records that it asked', async () => {
  const { requests, notify, recorded } = setUp({ accounts: [ADMIN, { uid: 'o1', email: 'op@rover.org', role: 'operator' }] });

  expect(await requests.request('t')).toEqual({ outcome: 'sent', notified: 1 });
  expect(notify).toHaveBeenCalledWith(['admin@rover.org'], 'new@rover.org');
  expect(recorded).toEqual([{ uid: 'u1', email: 'new@rover.org', subject: SUBJECT, sent: [{ to: 'admin@rover.org', emailId: 'id-1' }], earlier: [] }]);
});

it('answers a second request within the hour without emailing again', async () => {
  const existing: AccessRequestRecord = { email: 'new@rover.org', subject: SUBJECT, requestedAt: new Date(NOW - ACCESS_REQUEST_INTERVAL_MS + 1000).toISOString(), sent: [] };
  const { requests, notify } = setUp({ existing });

  expect((await requests.request('t')).outcome).toBe('already-asked');
  expect(notify).not.toHaveBeenCalled();
});

it('asks again once the hour is up and preserves the earlier emails', async () => {
  const existing: AccessRequestRecord = { email: 'new@rover.org', subject: SUBJECT, requestedAt: new Date(NOW - ACCESS_REQUEST_INTERVAL_MS - 1).toISOString(), sent: [{ to: 'admin@rover.org', emailId: 'old-id' }] };
  const { requests, recorded } = setUp({ existing });

  expect((await requests.request('t')).outcome).toBe('sent');
  expect(recorded[0].earlier).toEqual([{ to: 'admin@rover.org', emailId: 'old-id' }]);
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
