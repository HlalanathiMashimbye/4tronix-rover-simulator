/**
 * Delete alone sits behind the admin role, on the bookkeeping route (AB#379).
 *
 * Getting this backwards would either lock operators out of their own job or
 * hand everyone the one irreversible action. This used to be read off the
 * route's source text; it is driven through the handlers now, as a plain
 * operator.
 */

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

const OPERATOR = { uid: 'op-1', email: 'op@rover.org', role: 'operator', yardId: 'curiosity' };
const run = jest.fn(async () => ({ ok: true, message: 'Done.' }));
const deleteMission = jest.fn(async () => ({ ok: true, message: 'Deleted.' }));

jest.mock('@/infrastructure/auth/dal', () => ({
  requireOperator: async () => OPERATOR,
  // A plain operator: the admin check refuses them.
  requireAdmin: async () => {
    throw new ForbiddenError('admin only');
  },
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/container.server', () => ({
  operatorMissionCommands: () => ({ run, deleteMission }),
}));

import { NextRequest } from 'next/server';
import { DELETE, POST } from '@/app/api/operator/missions/[id]/route';

const params = Promise.resolve({ id: 'm1' });
const request = (method: string, body?: unknown) =>
  new NextRequest('https://example.com/api/operator/missions/m1', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => jest.clearAllMocks());

it('refuses a plain operator a delete, and deletes nothing', async () => {
  const response = await DELETE(request('DELETE'), { params });

  expect(response.status).toBe(403);
  expect(deleteMission).not.toHaveBeenCalled();
});

it('lets a plain operator do the bookkeeping that is their job', async () => {
  const response = await POST(request('POST', { action: 'complete', yardId: 'curiosity' }), { params });

  expect(response.status).not.toBe(403);
  expect(run).toHaveBeenCalled();
});
