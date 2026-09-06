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
const softDeleteRun = jest.fn();

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
    softDeleteRun: (...a: unknown[]) => softDeleteRun(...a),
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

// Top level, so every describe in this file gets it. Nested in one of them,
// the sibling blocks below ran with no session and stale mocks.
beforeEach(() => {
  jest.clearAllMocks();
  requireOperator.mockResolvedValue({ uid: 'u1', email: 'op@uct.ac.za', yardId: YARD });
  findById.mockResolvedValue({ id: 'm1', name: 'Rock Lover', status: 'completed', yardId: YARD });
  applyBookkeeping.mockResolvedValue(undefined);
  softDeleteRun.mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/operator/missions/[id] { action: "another-run" }', () => {

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

describe('acting on a named run', () => {
  const OTHER = 'durban';

  beforeEach(() => {
    findById.mockResolvedValue({ id: 'm1', name: 'Rock Lover', status: 'completed', yardId: YARD });
    findRuns.mockResolvedValue([
      { runId: 'mine-1', yardId: YARD, status: 'completed', startedAt: '2026-09-03T10:00:00Z' },
      { runId: 'mine-2', yardId: YARD, status: 'completed', startedAt: '2026-09-03T11:00:00Z' },
      { runId: 'theirs', yardId: OTHER, status: 'completed', startedAt: '2026-09-03T09:00:00Z' },
    ]);
  });

  function body(payload: Record<string, unknown>) {
    return new NextRequest('https://example.com/api/operator/missions/m1', {
      method: 'POST',
      body: JSON.stringify({ yardId: YARD, ...payload }),
    });
  }

  it('attaches a video to the run it names, not the latest one', async () => {
    // The whole reason runId is accepted: a mission with several attempts has
    // a recording per attempt, and the operator says which is which.
    const res = await POST(
      body({ action: 'attach-video', url: 'https://youtu.be/abc12345678', runId: 'mine-1' }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(applyBookkeeping.mock.calls[0][1]).toBe('mine-1');
  });

  it('falls back to the latest run when none is named', async () => {
    const res = await POST(
      body({ action: 'attach-video', url: 'https://youtu.be/abc12345678' }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(applyBookkeeping.mock.calls[0][1]).toBe('mine-2');
  });

  it('refuses to touch another yard\'s run', async () => {
    // runId arrives in the request body. Without the ownership check it is an
    // arbitrary document path, and an operator could attach a video to - or
    // clear one from - a different yard's attempt at the same mission.
    const res = await POST(
      body({ action: 'attach-video', url: 'https://youtu.be/abc12345678', runId: 'theirs' }),
      { params },
    );

    expect(res.status).toBe(403);
    expect(applyBookkeeping).not.toHaveBeenCalled();
  });

  it('404s on a run that does not exist', async () => {
    const res = await POST(
      body({ action: 'remove-video', runId: 'no-such-run' }),
      { params },
    );

    expect(res.status).toBe(404);
    expect(applyBookkeeping).not.toHaveBeenCalled();
  });

  it('clears the video rather than writing an empty one', async () => {
    const res = await POST(body({ action: 'remove-video', runId: 'mine-1' }), { params });

    expect(res.status).toBe(200);
    const change = applyBookkeeping.mock.calls[0][3];
    expect(change.clearsVideo).toBe(true);
    // Not a status change: taking a link off is not un-completing a run.
    expect(change.status).toBeNull();
  });

  it('soft-deletes a run without touching bookkeeping', async () => {
    const res = await POST(body({ action: 'delete-run', runId: 'mine-1' }), { params });

    expect(res.status).toBe(200);
    expect(softDeleteRun).toHaveBeenCalledWith('m1', 'mine-1', expect.any(String), 'op@uct.ac.za');
    expect(applyBookkeeping).not.toHaveBeenCalled();
  });

  it('refuses to delete another yard\'s run', async () => {
    const res = await POST(body({ action: 'delete-run', runId: 'theirs' }), { params });

    expect(res.status).toBe(403);
    expect(softDeleteRun).not.toHaveBeenCalled();
  });
});
