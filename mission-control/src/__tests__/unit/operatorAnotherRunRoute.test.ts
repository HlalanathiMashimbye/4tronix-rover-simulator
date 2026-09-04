/**
 * Logging a second run of a mission at the same yard.
 *
 * The one line that matters here is the runId. Every other action acts on the
 * run in front of the operator and reuses its id; 'another-run' must take a
 * fresh one. applyBookkeeping writes with merge:true, so reusing the id would
 * write the second attempt straight over the first - destroying exactly the
 * record this action exists to create, and silently, because the write
 * succeeds.
 */

const requireOperator = jest.fn();
const findById = jest.fn();
const findRuns = jest.fn();
const applyBookkeeping = jest.fn();

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireOperator: () => requireOperator(),
  requireAdmin: jest.fn(),
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/container.server', () => ({
  adminMissionRepository: () => ({
    findById: (...a: unknown[]) => findById(...a),
    findRuns: (...a: unknown[]) => findRuns(...a),
    applyBookkeeping: (...a: unknown[]) => applyBookkeeping(...a),
  }),
}));

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirestoreInstance: () => ({}),
}));

import { NextRequest } from 'next/server';

import { POST } from '@/app/api/operator/missions/[id]/route';

const YARD = 'curiosity';

function post(action: string) {
  return new NextRequest('https://example.com/api/operator/missions/m1', {
    method: 'POST',
    body: JSON.stringify({ action, yardId: YARD }),
  });
}

const params = Promise.resolve({ id: 'm1' });

describe('POST /api/operator/missions/[id] { action: "another-run" }', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireOperator.mockResolvedValue({ uid: 'u1', email: 'op@uct.ac.za', yardId: YARD });
    findById.mockResolvedValue({ id: 'm1', name: 'Rock Lover', status: 'completed', yardId: YARD });
    applyBookkeeping.mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes a NEW runId rather than merging over the completed run', async () => {
    findRuns.mockResolvedValue([
      { runId: 'existing-run', yardId: YARD, status: 'completed', startedAt: '2026-09-03T10:00:00Z' },
    ]);

    const res = await POST(post('another-run'), { params });

    expect(res.status).toBe(200);
    expect(applyBookkeeping).toHaveBeenCalledTimes(1);
    const [missionId, runId, yardId, change] = applyBookkeeping.mock.calls[0];
    expect(missionId).toBe('m1');
    expect(runId).not.toBe('existing-run');
    expect(runId).toBeTruthy();
    expect(yardId).toBe(YARD);
    // Completed, so the repository stamps completedAt - which is what
    // runToLink orders candidates by when the next video arrives.
    expect(change.status).toBe('completed');
  });

  it('is refused while the run is still open', async () => {
    findRuns.mockResolvedValue([
      { runId: 'existing-run', yardId: YARD, status: 'processing', startedAt: '2026-09-03T10:00:00Z' },
    ]);

    const res = await POST(post('another-run'), { params });

    expect(res.status).toBe(409);
    expect(applyBookkeeping).not.toHaveBeenCalled();
  });

  it('still reuses the run id for an ordinary complete', async () => {
    // The contrast that makes the assertion above mean something.
    findById.mockResolvedValue({ id: 'm1', name: 'Rock Lover', status: 'queued', yardId: YARD });
    findRuns.mockResolvedValue([
      { runId: 'existing-run', yardId: YARD, status: 'queued', startedAt: '2026-09-03T10:00:00Z' },
    ]);

    const res = await POST(post('complete'), { params });

    expect(res.status).toBe(200);
    expect(applyBookkeeping.mock.calls[0][1]).toBe('existing-run');
  });
});
