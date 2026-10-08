/**
 * The leaderboard migration is admin-only.
 *
 * It reads every learner record and rewrites leaderboard entries through the
 * Admin SDK, which ignores Firestore rules. It shipped with no auth check, so
 * on a deployed site anyone who found the URL could run it. The assertion that
 * matters most is that a refused caller never reaches Firestore at all.
 */

const requireAdmin = jest.fn();
const getFirestoreInstance = jest.fn();

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireAdmin: () => requireAdmin(),
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirestoreInstance: () => getFirestoreInstance(),
}));

jest.mock('@/infrastructure/container.server', () => ({
  adminLeaderboardRepository: () => ({}),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/admin/migrate-challenges-to-leaderboard/route';

function post() {
  return new NextRequest('https://example.com/api/admin/migrate-challenges-to-leaderboard', {
    method: 'POST',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/admin/migrate-challenges-to-leaderboard', () => {
  it('refuses a visitor who is not signed in, before reading any learner', async () => {
    requireAdmin.mockRejectedValue(new UnauthorizedError());

    const res = await POST(post());

    expect(res.status).toBe(401);
    expect(getFirestoreInstance).not.toHaveBeenCalled();
  });

  it('refuses an operator who is not an admin', async () => {
    requireAdmin.mockRejectedValue(new ForbiddenError());

    const res = await POST(post());

    expect(res.status).toBe(403);
    expect(getFirestoreInstance).not.toHaveBeenCalled();
  });

  it('runs for an admin', async () => {
    requireAdmin.mockResolvedValue({ uid: 'a1', role: 'admin' });
    getFirestoreInstance.mockReturnValue({
      collection: () => ({ get: async () => ({ size: 0, docs: [] }) }),
    });

    const res = await POST(post());

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
