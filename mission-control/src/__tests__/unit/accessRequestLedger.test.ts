/**
 * The access request ledger, against an in-memory Firestore.
 *
 * Closing has to delete it: a person whose access is later removed and who
 * asks again makes a new request, and the reply to that one must not also
 * answer the emails of this one.
 */

const docs = new Map<string, Record<string, unknown>>();
const deleted: string[] = [];

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirestoreInstance: () => ({
    collection: (name: string) => ({
      doc: (id: string) => {
        const key = `${name}/${id}`;
        return {
          get: async () => ({ exists: docs.has(key), data: () => docs.get(key) }),
          set: async (data: Record<string, unknown>) => void docs.set(key, data),
          delete: async () => {
            deleted.push(key);
            docs.delete(key);
          },
        };
      },
    }),
  }),
}));

import { FirestoreAccessRequestLedger } from '@/infrastructure/auth/FirestoreAccessRequestLedger';

const ledger = new FirestoreAccessRequestLedger();

beforeEach(() => {
  docs.clear();
  deleted.length = 0;
});

it('closes a request once, and returns the emails it went out as', async () => {
  await ledger.record('g1', 'thandi@school.org', 'thandi@school.org is asking for operator access', [{ to: 'admin@rover.com', emailId: 'e1' }], []);

  const closed = await ledger.close('g1');

  expect(closed?.subject).toBe('thandi@school.org is asking for operator access');
  expect(closed?.sent).toEqual([{ to: 'admin@rover.com', emailId: 'e1' }]);
  expect(deleted).toEqual(['operatorAccessRequests/g1']);
  expect(await ledger.find('g1')).toBeNull();
  expect(await ledger.close('g1')).toBeNull();
});

it("adds a second request's emails to the first one's", async () => {
  await ledger.record('g1', 'thandi@school.org', 'thandi@school.org is asking for operator access', [{ to: 'admin@rover.com', emailId: 'e1' }], []);
  const earlier = await ledger.find('g1');

  await ledger.record('g1', 'thandi@school.org', 'thandi@school.org is asking for operator access', [{ to: 'admin@rover.com', emailId: 'e2' }], earlier?.sent ?? []);

  expect((await ledger.find('g1'))?.sent.map((s) => s.emailId)).toEqual(['e1', 'e2']);
});

it('reads a request recorded before replies existed as one with no emails to answer', async () => {
  docs.set('operatorAccessRequests/g1', { email: 'thandi@school.org', requestedAt: '2026-10-01T00:00:00Z', notified: 2 });

  const request = await ledger.find('g1');

  expect(request).toEqual({ email: 'thandi@school.org', subject: null, requestedAt: '2026-10-01T00:00:00Z', sent: [] });
});
