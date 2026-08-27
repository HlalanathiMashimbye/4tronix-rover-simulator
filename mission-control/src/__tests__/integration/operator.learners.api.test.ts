/**
 * Resolving learner refs for the operator queue (AB#377).
 *
 * This route exists because learnerRef is a one-way hash and browsers are
 * denied `list` on learners, so it is the one place that can join the two. That
 * makes it the one place that could leak the collection, which is what these
 * tests are about.
 */

const requireOperator = jest.fn();
const whereFn = jest.fn();
const getFn = jest.fn();

jest.mock('@/lib/auth/dal', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    requireOperator: (...a: unknown[]) => requireOperator(...a),
    UnauthorizedError,
    ForbiddenError,
  };
});

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirestoreInstance: () => ({
    collection: () => ({ where: whereFn }),
  }),
}));

import { POST } from '@/app/api/operator/learners/route';
import { UnauthorizedError } from '@/lib/auth/dal';
import { NextRequest } from 'next/server';

function learnerDoc(ref: string, fields: Record<string, unknown>) {
  return { get: (k: string) => (k === 'learnerRef' ? ref : fields[k]) };
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/operator/learners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  requireOperator.mockResolvedValue({ uid: 'op', email: 'op@rover.com', role: 'operator' });
  whereFn.mockReturnValue({ get: getFn });
  getFn.mockResolvedValue({ docs: [] });
});

describe('access', () => {
  it('401s anyone without an operator session', async () => {
    requireOperator.mockRejectedValue(new UnauthorizedError());
    const response = await post({ refs: ['abc'] });
    expect(response.status).toBe(401);
    expect(whereFn).not.toHaveBeenCalled();
  });
});

describe('what it returns', () => {
  it('maps refs to the small profile the queue renders', async () => {
    getFn.mockResolvedValue({
      docs: [learnerDoc('ref1', { displayName: 'Nomsa', avatarColor: '#8B5CF6', missionCount: 3 })],
    });

    const data = await (await post({ refs: ['ref1'] })).json();

    expect(data.profiles.ref1).toEqual({
      displayName: 'Nomsa',
      avatarColor: '#8B5CF6',
      missionCount: 3,
    });
  });

  it('never returns an email, even when the record still carries one', async () => {
    // Addresses live in learners/{id}/private, but one legacy record still has
    // a top-level one. A queue screen may be facing a room full of people.
    getFn.mockResolvedValue({
      docs: [learnerDoc('ref1', { avatarColor: '#000', learnerEmail: 'child@example.com' })],
    });

    const body = await (await post({ refs: ['ref1'] })).text();

    expect(body).not.toContain('child@example.com');
    expect(body).not.toContain('learnerEmail');
  });

  it('omits a display name nobody has set rather than inventing one', async () => {
    // Every learner record today has none, because no UI calls
    // updateDisplayName. The queue shows the avatar colour instead.
    getFn.mockResolvedValue({ docs: [learnerDoc('ref1', { avatarColor: '#000' })] });

    const data = await (await post({ refs: ['ref1'] })).json();

    expect(data.profiles.ref1.displayName).toBeUndefined();
    expect(data.profiles.ref1.avatarColor).toBe('#000');
  });
});

describe('bounds', () => {
  it('batches around the 30-value ceiling on an in filter', async () => {
    // The queue holds up to 50, and Firestore caps `in` at 30, so a full queue
    // needs two round trips rather than one that throws.
    const refs = Array.from({ length: 45 }, (_, i) => `ref${i}`);
    await post({ refs });

    expect(whereFn).toHaveBeenCalledTimes(2);
    expect(whereFn.mock.calls[0][2]).toHaveLength(30);
    expect(whereFn.mock.calls[1][2]).toHaveLength(15);
  });

  it('deduplicates refs, since one learner can hold several queue slots', async () => {
    await post({ refs: ['same', 'same', 'same'] });
    expect(whereFn.mock.calls[0][2]).toEqual(['same']);
  });

  it('refuses to resolve more than one queue of refs', async () => {
    const refs = Array.from({ length: 500 }, (_, i) => `ref${i}`);
    await post({ refs });
    const asked = whereFn.mock.calls.reduce((n, c) => n + (c[2] as string[]).length, 0);
    expect(asked).toBeLessThanOrEqual(50);
  });

  it('does not query at all for an empty list', async () => {
    const data = await (await post({ refs: [] })).json();
    expect(data.profiles).toEqual({});
    expect(whereFn).not.toHaveBeenCalled();
  });

  it('rejects a body that is not a list of strings', async () => {
    expect((await post({ refs: 'not-an-array' })).status).toBe(400);
    expect((await post({ refs: [1, 2] })).status).toBe(400);
  });
});
