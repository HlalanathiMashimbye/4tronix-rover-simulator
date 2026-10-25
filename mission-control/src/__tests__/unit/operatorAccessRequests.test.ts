/**
 * The record of a request for operator access, against an in-memory Firestore.
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

import {
  closeAccessRequest,
  findAccessRequest,
  recordAccessRequest,
} from '@/infrastructure/auth/operatorAccessRequests';

beforeEach(() => {
  docs.clear();
  deleted.length = 0;
});

const ASKED = { email: 'thandi@school.org', subject: 'thandi@school.org is asking for operator access' };

it('closes a request once, and returns the emails it went out as', async () => {
  await recordAccessRequest('g1', { ...ASKED, sent: [{ to: 'admin@rover.com', emailId: 'e1' }] }, null);

  const closed = await closeAccessRequest('g1');

  expect(closed?.subject).toBe(ASKED.subject);
  expect(closed?.sent).toEqual([{ to: 'admin@rover.com', emailId: 'e1' }]);
  expect(deleted).toEqual(['operatorAccessRequests/g1']);
  expect(await findAccessRequest('g1')).toBeNull();
  expect(await closeAccessRequest('g1')).toBeNull();
});

it("adds a second request's emails to the first one's", async () => {
  await recordAccessRequest('g1', { ...ASKED, sent: [{ to: 'admin@rover.com', emailId: 'e1' }] }, null);
  const earlier = await findAccessRequest('g1');

  await recordAccessRequest('g1', { ...ASKED, sent: [{ to: 'admin@rover.com', emailId: 'e2' }] }, earlier);

  expect((await findAccessRequest('g1'))?.sent.map((s) => s.emailId)).toEqual(['e1', 'e2']);
});

it('reads a request recorded before replies existed as one with no emails to answer', async () => {
  docs.set('operatorAccessRequests/g1', { email: 'thandi@school.org', requestedAt: '2026-10-01T00:00:00Z', notified: 2 });

  const request = await findAccessRequest('g1');

  expect(request).toEqual({ email: 'thandi@school.org', subject: null, requestedAt: '2026-10-01T00:00:00Z', sent: [] });
});
