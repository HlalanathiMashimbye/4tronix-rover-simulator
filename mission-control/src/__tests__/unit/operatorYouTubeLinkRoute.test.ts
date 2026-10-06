/**
 * The linker's state, for the operator console's status line.
 */

const requireOperator = jest.fn();
const readLinkerState = jest.fn();

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireOperator: () => requireOperator(),
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/persistence/pollState', () => ({
  readLinkerState: () => readLinkerState(),
}));

import { GET } from '@/app/api/operator/youtube-link/route';

beforeEach(() => {
  jest.clearAllMocks();
  requireOperator.mockResolvedValue({ uid: 'op', role: 'operator' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('refuses anyone who is not signed in as an operator, without reading Firestore', async () => {
  requireOperator.mockRejectedValue(new UnauthorizedError());

  expect((await GET()).status).toBe(401);
  expect(readLinkerState).not.toHaveBeenCalled();
});

it('refuses a signed-in account that is not an operator', async () => {
  requireOperator.mockRejectedValue(new ForbiddenError());

  expect((await GET()).status).toBe(403);
});

it('returns the last check and the interval it ran under', async () => {
  readLinkerState.mockResolvedValue({ lastCheckedAt: new Date('2026-09-17T13:00:10.505Z'), intervalMinutes: 15 });

  const response = await GET();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, lastCheckedAt: '2026-09-17T13:00:10.505Z', intervalMinutes: 15 });
});

it('reports a linker that has never run as null, not as an error', async () => {
  readLinkerState.mockResolvedValue({ lastCheckedAt: null, intervalMinutes: 15 });

  expect(await (await GET()).json()).toMatchObject({ success: true, lastCheckedAt: null });
});
