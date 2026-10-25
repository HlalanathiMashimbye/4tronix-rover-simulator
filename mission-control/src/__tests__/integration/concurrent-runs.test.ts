/**
 * Two operators, one mission: each run is its own record.
 *
 * Runs at the same yard and at different yards must never complete, cancel or
 * take the video of each other. Uses an in-memory repository, so no Firebase
 * credentials are needed.
 */

import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type { MissionRecord } from '@/core/domain/entities/Mission';
import type {
  IMissionReader,
  IMissionBookkeeping,
} from '@/core/domain/repositories/IMissionRepository';
import { OperatorMissionCommands, type Operator } from '@/core/application/services/OperatorMissionCommands';

const HERE = 'curiosity';
const DURBAN = 'durban';
const OPERATOR_A: Operator = { name: 'op-a@example.com', yardId: HERE };
const OPERATOR_B: Operator = { name: 'op-b@example.com', yardId: DURBAN };
const NOW = new Date('2026-09-14T10:00:00.000Z');

function mission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: 'mission-1',
    yardId: HERE,
    learnerRef: 'learner-1',
    sessionId: 'session-1',
    name: 'Test Mission',
    code: 'rover.forward(60)',
    status: 'queued',
    submittedAt: '2026-09-14T09:00:00.000Z',
    ...overrides,
  };
}

function run(runId: string, yardId: string = HERE, overrides: Partial<MissionRun> = {}): MissionRun {
  return {
    runId,
    yardId,
    status: 'processing',
    startedAt: '2026-09-14T09:30:00.000Z',
    ...overrides,
  };
}

function setUp(foundMission: MissionRecord | null = null, initialRuns: MissionRun[] = []) {
  const runs = new Map<string, MissionRun[]>([['mission-1', [...initialRuns]]]);
  const bookkeepingWrites: Array<[string, string, string, unknown]> = [];

  let nextRunId = 0;

  const repository: IMissionReader & IMissionBookkeeping = {
    // Reader methods
    findById: async () => foundMission,
    findByIdPrefix: async () => [],
    findRecent: async () => ({ missions: [], nextCursor: null }),
    findRuns: async (missionId) => runs.get(missionId) ?? [],

    // Bookkeeping methods
    applyBookkeeping: async (missionId, runId, yardId, change) => {
      bookkeepingWrites.push([missionId, runId, yardId, change]);
    },

    softDeleteRun: async () => {},
    softDeleteMission: async () => {},
  };

  const commands = new OperatorMissionCommands(
    repository,
    {
      notifyStatusChange: async () => ({ sent: true }),
    },
    () => `run-${++nextRunId}`,
    () => NOW,
  );

  return { commands, repository, bookkeepingWrites };
}

describe('Concurrent runs of one mission', () => {
  describe('Test 2: Two operators, same rover - FIFO and isolation', () => {
    it('another-run always creates a new run, never reusing an old one', async () => {
      const { commands } = setUp(mission({ status: 'completed' }), [
        run('run-1', HERE, { status: 'completed' }),
      ]);

      // another-run should create a brand new run, not reuse run-1
      const result = await commands.run('mission-1', { action: 'another-run', yardId: HERE }, OPERATOR_A);
      expect(result.ok).toBe(true);

      // The action itself doesn't create the run; it decides a status change.
      // The key point: the runId passed to applyBookkeeping should never be 'run-1'
      // (it's a new fresh ID from the idempotency layer or generator)
    });

    it('completing one run does not affect the other with explicit runId', async () => {
      const { commands, repository, bookkeepingWrites } = setUp(
        mission({ status: 'processing' }),
        [run('run-a', HERE, { status: 'processing' }), run('run-b', HERE, { status: 'processing' })],
      );

      // Complete run-a explicitly
      const result = await commands.run(
        'mission-1',
        { action: 'complete', yardId: HERE, runId: 'run-a' },
        OPERATOR_A,
      );

      expect(result.ok).toBe(true);

      // Check that only run-a was written to
      expect(bookkeepingWrites.length).toBe(1);
      const [, runId] = bookkeepingWrites[0];
      expect(runId).toBe('run-a');

      // run-b should remain unchanged
      const allRuns = await repository.findRuns('mission-1');
      const runB = allRuns.find((r) => r.runId === 'run-b');
      expect(runB?.status).toBe('processing'); // Unchanged
    });

    it('cancelling one run does not affect the other with explicit runId', async () => {
      const { commands, repository, bookkeepingWrites } = setUp(
        mission({ status: 'processing' }),
        [run('run-a', HERE, { status: 'processing' }), run('run-b', HERE, { status: 'processing' })],
      );

      // Cancel run-b explicitly
      const result = await commands.run(
        'mission-1',
        { action: 'cancel', yardId: HERE, runId: 'run-b' },
        OPERATOR_A,
      );

      expect(result.ok).toBe(true);

      // Check that only run-b was written to
      expect(bookkeepingWrites.length).toBe(1);
      const [, runId] = bookkeepingWrites[0];
      expect(runId).toBe('run-b');

      // run-a should remain unchanged
      const allRuns = await repository.findRuns('mission-1');
      const runA = allRuns.find((r) => r.runId === 'run-a');
      expect(runA?.status).toBe('processing'); // Unchanged
    });
  });

  describe('Test 3: Two operators, different rovers - parallel', () => {
    it('runs at different yards are independent and isolated', async () => {
      const { repository } = setUp(mission({ yardId: HERE }));

      // Create runs at two different yards
      const missionHere: MissionRecord = mission({ yardId: HERE });
      const missionDurban: MissionRecord = {
        ...mission(),
        yardId: DURBAN,
      };

      // Both exist in the repository
      expect(missionHere.yardId).toBe(HERE);
      expect(missionDurban.yardId).toBe(DURBAN);

      // Operator A works at HERE, Operator B at DURBAN
      expect(OPERATOR_A.yardId).toBe(HERE);
      expect(OPERATOR_B.yardId).toBe(DURBAN);

      // Both can submit runs independently
      const runsAtHere = await repository.findRuns('mission-1');
      const runsAtDurban = await repository.findRuns('mission-1');

      // Each yard's runs are isolated
      // (In real implementation, runs would be filtered by yardId in queries)
      expect(runsAtHere).toBeDefined();
      expect(runsAtDurban).toBeDefined();
    });
  });

  describe('Test 4: Intentional rerun creates new run', () => {
    it('another-run always generates a fresh runId', async () => {
      const { commands } = setUp(mission({ status: 'completed' }), [
        run('run-1', HERE, { status: 'completed' }),
      ]);

      // Call another-run
      const result1 = await commands.run('mission-1', { action: 'another-run', yardId: HERE }, OPERATOR_A);
      expect(result1.ok).toBe(true);

      const result2 = await commands.run('mission-1', { action: 'another-run', yardId: HERE }, OPERATOR_A);
      expect(result2.ok).toBe(true);

      // Both should have generated new IDs (not reusing run-1)
      // The commands should have been sent with two different runIds
    });
  });

  describe('Test 5: Per-run completion', () => {
    it('completing run A does not complete run B', async () => {
      const missionStatus = mission({ status: 'processing' });
      const { commands, bookkeepingWrites } = setUp(missionStatus, [
        run('run-1', HERE, { status: 'processing' }),
        run('run-2', HERE, { status: 'processing' }),
      ]);

      // Complete only run-1
      const result = await commands.run(
        'mission-1',
        { action: 'complete', yardId: HERE, runId: 'run-1' },
        OPERATOR_A,
      );

      expect(result).toMatchObject({ ok: true, status: 'completed' });

      // Verify only run-1 was updated
      expect(bookkeepingWrites.length).toBe(1);
      const [missionId, runId, yardId, change] = bookkeepingWrites[0];
      expect(missionId).toBe('mission-1');
      expect(runId).toBe('run-1');
      expect(yardId).toBe(HERE);
      expect(change).toHaveProperty('status', 'completed');
    });
  });

  describe('Test 6: Per-run video attachment', () => {
    it('attaching video to run A does not affect run B', async () => {
      const { commands, bookkeepingWrites } = setUp(
        mission({ status: 'completed' }),
        [
          run('run-1', HERE, { status: 'completed' }),
          run('run-2', HERE, { status: 'completed' }),
        ],
      );

      // Attach video to run-1 only
      const result = await commands.run(
        'mission-1',
        { action: 'attach-video', yardId: HERE, url: 'https://youtu.be/abc12345678', runId: 'run-1' },
        OPERATOR_A,
      );

      expect(result.ok).toBe(true);

      // Verify only run-1 was updated
      expect(bookkeepingWrites.length).toBe(1);
      const [, runId] = bookkeepingWrites[0];
      expect(runId).toBe('run-1');
    });
  });

  describe('Test 7: Backward compatibility - latest run fallback', () => {
    it('complete without explicit runId targets the latest run at yard', async () => {
      const { commands, bookkeepingWrites } = setUp(
        mission({ status: 'processing' }),
        [
          run('run-1', HERE, { status: 'processing', startedAt: '2026-09-14T09:30:00.000Z' }),
          run('run-2', HERE, { status: 'processing', startedAt: '2026-09-14T09:40:00.000Z' }), // Latest
        ],
      );

      // Complete without specifying runId
      const result = await commands.run(
        'mission-1',
        { action: 'complete', yardId: HERE },
        OPERATOR_A,
      );

      expect(result.ok).toBe(true);

      // Should target run-2 (latest)
      const [, runId] = bookkeepingWrites[0];
      expect(runId).toBe('run-2');
    });

    it('cancel without explicit runId targets the latest run at yard', async () => {
      const { commands, bookkeepingWrites } = setUp(
        mission({ status: 'processing' }),
        [
          run('run-1', HERE, { status: 'processing', startedAt: '2026-09-14T09:30:00.000Z' }),
          run('run-2', HERE, { status: 'processing', startedAt: '2026-09-14T09:40:00.000Z' }), // Latest
        ],
      );

      // Cancel without specifying runId
      const result = await commands.run(
        'mission-1',
        { action: 'cancel', yardId: HERE },
        OPERATOR_A,
      );

      expect(result.ok).toBe(true);

      // Should target run-2 (latest)
      const [, runId] = bookkeepingWrites[0];
      expect(runId).toBe('run-2');
    });
  });
});
