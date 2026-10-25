/**
 * The handoff route signs only for a signed-in operator, and only for their yard.
 */

const requireOperator = jest.fn();
const handoff = jest.fn();

class UnauthorizedError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireOperator: () => requireOperator(),
  UnauthorizedError,
}));

jest.mock('@/infrastructure/container.server', () => ({
  missionHandoffService: () => ({ handoff }),
}));

import { POST } from '@/app/api/operator/missions/[id]/handoff/route';

const call = () => POST(new Request('http://localhost/api/operator/missions/m1/handoff', { method: 'POST' }), {
  params: Promise.resolve({ id: 'm1' }),
});

beforeEach(() => {
  jest.clearAllMocks();
  requireOperator.mockResolvedValue({ uid: 'op', role: 'operator', yardId: 'curiosity' });
});

it('refuses anyone not signed in, and signs nothing', async () => {
  requireOperator.mockRejectedValue(new UnauthorizedError());

  expect((await call()).status).toBe(401);
  expect(handoff).not.toHaveBeenCalled();
});

it("asks for the handoff for the session's own yard", async () => {
  handoff.mockResolvedValue({ ok: true, yardId: 'curiosity', missionId: 'm1', code: 'c', expires: 1, signature: 's' });

  const response = await call();

  expect(handoff).toHaveBeenCalledWith('m1', 'curiosity');
  expect(await response.json()).toEqual({ success: true, yardId: 'curiosity', missionId: 'm1', code: 'c', expires: 1, signature: 's' });
});

it('turns a mission at another yard into 403', async () => {
  handoff.mockResolvedValue({ ok: false, failure: 'forbidden', error: 'That mission is at another yard.' });

  expect((await call()).status).toBe(403);
});
