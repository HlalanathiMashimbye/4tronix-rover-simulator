/**
 * An operator may only act on the yard they signed in at.
 *
 * The yard used to be a localStorage preference the request body carried, so
 * a stale tab could record a Cape Town run against Durban and nothing would
 * notice until a child's video turned up in the wrong city.
 *
 * Worth a real test rather than a reading one: the existing coverage for this
 * route reads the file as text and asserts on strings, so a guard added to it
 * can be entirely broken with every suite still green.
 */

const requireOperator = jest.fn();
const applyBookkeeping = jest.fn();
const findRuns = jest.fn(async () => []);

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireOperator: () => requireOperator(),
  requireAdmin: () => requireOperator(),
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/container.server', () => ({
  adminMissionRepository: () => ({
    // Processing, so 'complete' is a decision the bookkeeping allows and the
    // test is about the yard guard rather than about mission state.
    findById: async () => ({ id: 'm1', status: 'processing', yardId: 'curiosity' }),
    findRuns: () => findRuns(),
    applyBookkeeping: (...a: unknown[]) => applyBookkeeping(...a),
  }),
}));

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirestoreInstance: () => ({}),
  getFirebaseAdminAuth: () => ({}),
}));

jest.mock('@/infrastructure/email/resend-client', () => ({ ResendEmailSender: class {} }));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/operator/missions/[id]/route';

function post(body: unknown) {
  return new NextRequest('https://example.com/api/operator/missions/m1', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'm1' });

describe('acting on a mission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireOperator.mockResolvedValue({
      uid: 'u1', email: 'op@uct.ac.za', role: 'operator', yardId: 'curiosity',
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses a yard the operator did not sign in at', async () => {
    const resp = await POST(post({ action: 'complete', yardId: 'durban' }), { params });

    expect(resp.status).toBe(403);
    expect((await resp.json()).error).toMatch(/sign out to change yards/i);
    expect(applyBookkeeping).not.toHaveBeenCalled();
  });

  it('refuses a session that predates choosing a yard', async () => {
    requireOperator.mockResolvedValue({ uid: 'u1', role: 'operator', yardId: null });

    const resp = await POST(post({ action: 'complete', yardId: 'curiosity' }), { params });

    expect(resp.status).toBe(403);
    expect((await resp.json()).error).toMatch(/sign in again/i);
    expect(applyBookkeeping).not.toHaveBeenCalled();
  });

  it('allows the yard the operator is actually standing at', async () => {
    const resp = await POST(post({ action: 'complete', yardId: 'curiosity' }), { params });

    expect(resp.status).toBe(200);
    expect(applyBookkeeping).toHaveBeenCalled();
  });
});
