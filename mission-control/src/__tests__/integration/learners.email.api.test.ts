/**
 * Saving a learner's address over HTTP, and where it lands in Firestore.
 *
 * Untested until the Firestore writes moved out of the route. The route is
 * driven with the writer stubbed; the writer is driven against a recording
 * Firestore, so both halves are checked on their own.
 */

const save = jest.fn();

jest.mock('@/infrastructure/container.server', () => ({
  learnerContactWriter: () => ({ save: (...a: unknown[]) => save(...a) }),
  // The route now checks a rate limit; these tests are about the write, so the
  // limiter always allows. rateLimit.api.test.ts covers the limit itself.
  rateLimiter: () => ({ allow: async () => true }),
}));

import { NextRequest } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { POST } from '@/app/api/learners/[id]/email/route';
import { FirestoreLearnerContactWriter } from '@/infrastructure/persistence/FirestoreLearnerContactWriter';

function post(id: string, body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/learners/${id}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  save.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the route', () => {
  it('saves a valid address for the learner it names', async () => {
    expect((await post('learner-1', { email: 'kid@example.com' })).status).toBe(200);
    expect(save).toHaveBeenCalledWith('learner-1', 'kid@example.com');
  });

  it('clears the address when sent null', async () => {
    expect((await post('learner-1', { email: null })).status).toBe(200);
    expect(save).toHaveBeenCalledWith('learner-1', null);
  });

  it.each([
    ['something that is not an address', { email: 'not-an-email' }],
    ['no body at all', '{'],
  ])('refuses %s and saves nothing', async (_case, body) => {
    expect((await post('learner-1', body)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses an id longer than any learner id', async () => {
    expect((await post('x'.repeat(65), { email: 'kid@example.com' })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('says it failed when the write fails', async () => {
    save.mockRejectedValue(new Error('quota'));
    expect((await post('learner-1', { email: 'kid@example.com' })).status).toBe(500);
  });
});

describe('the writer', () => {
  function recordingFirestore() {
    const writes: Array<{ path: string; op: string; data?: unknown }> = [];
    const docRef = (path: string): unknown => ({
      collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
      set: async (data: unknown) => void writes.push({ path, op: 'set', data }),
      delete: async () => void writes.push({ path, op: 'delete' }),
    });
    const firestore = { collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }) };
    return { firestore: firestore as unknown as Firestore, writes };
  }

  it('puts the address in the private contact record and clears any left on the readable document', async () => {
    const { firestore, writes } = recordingFirestore();

    await new FirestoreLearnerContactWriter(firestore).save('learner-1', 'kid@example.com');

    expect(writes[0]).toMatchObject({ path: 'learners/learner-1/private/contact', op: 'set', data: { learnerEmail: 'kid@example.com' } });
    expect(writes[1]).toEqual({ path: 'learners/learner-1', op: 'set', data: { learnerEmail: null } });
  });

  it('deletes the private record when the learner removes their address', async () => {
    const { firestore, writes } = recordingFirestore();

    await new FirestoreLearnerContactWriter(firestore).save('learner-1', null);

    expect(writes[0]).toEqual({ path: 'learners/learner-1/private/contact', op: 'delete' });
  });
});
