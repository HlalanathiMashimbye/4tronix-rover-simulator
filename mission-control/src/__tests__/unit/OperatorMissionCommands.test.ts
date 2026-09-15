/**
 * The operator's bookkeeping commands, with no route in sight.
 *
 * These used to be reachable only through POST /api/operator/missions/[id], so
 * every question about bookkeeping needed the auth layer, the container and a
 * NextRequest mocked before it could be asked. The route tests still cover the
 * HTTP half. These cover the decisions, the yard checks and the write, against
 * an in-memory repository.
 */

import {
  OperatorMissionCommands,
  type LearnerNotifier,
  type Operator,
} from '@/core/application/services/OperatorMissionCommands';
import type {
  IMissionBookkeeping,
  IMissionReader,
} from '@/core/domain/repositories/IMissionRepository';
import type { Mission, MissionStatus } from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

const HERE = 'curiosity';
const OPERATOR: Operator = { name: 'op@uct.ac.za', yardId: HERE };
const NOW = new Date('2026-09-14T10:00:00.000Z');

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    yardId: HERE,
    learnerRef: 'learner-1',
    sessionId: 'session-1',
    name: 'Rock Lover',
    code: 'rover.forward(60)',
    status: 'processing',
    submittedAt: '2026-09-14T09:00:00.000Z',
    ...overrides,
  };
}

function run(runId: string, overrides: Partial<MissionRun> = {}): MissionRun {
  return {
    runId,
    yardId: HERE,
    status: 'processing',
    startedAt: '2026-09-14T09:30:00.000Z',
    ...overrides,
  };
}

function setUp(found: Mission | null, runs: MissionRun[] = [], notifier?: LearnerNotifier) {
  const written: Array<Parameters<IMissionBookkeeping['applyBookkeeping']>> = [];
  const deletedRuns: Array<Parameters<IMissionBookkeeping['softDeleteRun']>> = [];
  const deletedMissions: Array<Parameters<IMissionBookkeeping['softDeleteMission']>> = [];
  const emailed: MissionStatus[] = [];

  const repository: IMissionReader & IMissionBookkeeping = {
    findById: async () => found,
    findRecent: async () => ({ missions: [], nextCursor: null }),
    findRuns: async () => runs,
    upsertRun: async () => {},
    applyBookkeeping: async (...args) => {
      written.push(args);
    },
    softDeleteRun: async (...args) => {
      deletedRuns.push(args);
    },
    softDeleteMission: async (...args) => {
      deletedMissions.push(args);
    },
  };

  const learnerEmail: LearnerNotifier = notifier ?? {
    notifyStatusChange: async (_mission, status) => {
      emailed.push(status);
      return { sent: true };
    },
  };

  let ids = 0;
  const commands = new OperatorMissionCommands(
    repository,
    learnerEmail,
    () => `new-run-${++ids}`,
    () => NOW,
  );

  return { commands, written, deletedRuns, deletedMissions, emailed };
}

describe('acting on the run in front of the operator', () => {
  it("completes the latest run at this yard, not an older one or another yard's", async () => {
    const { commands, written } = setUp(mission(), [
      run('last-week', { startedAt: '2026-09-07T09:00:00.000Z' }),
      run('today'),
      run('durban', { yardId: 'durban', startedAt: '2026-09-14T09:59:00.000Z' }),
    ]);

    const result = await commands.run('m1', { action: 'complete', yardId: HERE }, OPERATOR);

    expect(result).toMatchObject({ ok: true, missionId: 'm1', status: 'completed' });
    const [missionId, runId, yardId, change] = written[0];
    expect([missionId, runId, yardId]).toEqual(['m1', 'today', HERE]);
    expect(change).toMatchObject({
      status: 'completed',
      decidedBy: 'op@uct.ac.za',
      decidedAt: NOW.toISOString(),
    });
  });

  it('writes a new run for a yard that never flushed one', async () => {
    const { commands, written } = setUp(mission(), []);

    await commands.run('m1', { action: 'complete', yardId: HERE }, OPERATOR);

    expect(written[0][1]).toBe('new-run-1');
  });

  it("gives another run a fresh id, never the finished run's", async () => {
    // Reusing the id would merge the second attempt over the first.
    const { commands, written } = setUp(mission({ status: 'completed' }), [
      run('first', { status: 'completed' }),
    ]);

    const result = await commands.run('m1', { action: 'another-run', yardId: HERE }, OPERATOR);

    expect(result.ok).toBe(true);
    expect(written[0][1]).toBe('new-run-1');
  });

  it('writes to the run a video action names, not the latest', async () => {
    const { commands, written } = setUp(mission({ status: 'completed' }), [
      run('mine-1', { status: 'completed', startedAt: '2026-09-14T09:00:00.000Z' }),
      run('mine-2', { status: 'completed', startedAt: '2026-09-14T09:40:00.000Z' }),
    ]);

    await commands.run(
      'm1',
      { action: 'attach-video', yardId: HERE, url: 'https://youtu.be/abc12345678', runId: 'mine-1' },
      OPERATOR,
    );

    expect(written[0][1]).toBe('mine-1');
    expect(written[0][3]).toMatchObject({ youtubeUrl: 'https://youtu.be/abc12345678', status: null });
  });
});

describe('the yard the operator is standing at', () => {
  it('refuses a command for another yard, and writes nothing', async () => {
    const { commands, written } = setUp(mission(), [run('today')]);

    const result = await commands.run('m1', { action: 'complete', yardId: 'durban' }, OPERATOR);

    expect(result).toEqual({
      ok: false,
      failure: 'forbidden',
      error: 'That mission is at another yard. Sign out to change yards.',
    });
    expect(written).toEqual([]);
  });

  it("refuses to touch another yard's run by naming it", async () => {
    const { commands, written } = setUp(mission({ status: 'completed' }), [
      run('theirs', { yardId: 'durban', status: 'completed' }),
    ]);

    const result = await commands.run(
      'm1',
      { action: 'remove-video', yardId: HERE, runId: 'theirs' },
      OPERATOR,
    );

    expect(result).toMatchObject({ ok: false, failure: 'forbidden' });
    expect(written).toEqual([]);
  });

  it('reports a named run that does not exist as not found', async () => {
    const { commands } = setUp(mission({ status: 'completed' }), [run('mine', { status: 'completed' })]);

    const result = await commands.run(
      'm1',
      { action: 'remove-video', yardId: HERE, runId: 'no-such-run' },
      OPERATOR,
    );

    expect(result).toMatchObject({ ok: false, failure: 'not-found', error: 'Run not found' });
  });
});

describe("what the mission's state allows", () => {
  it('turns a refused decision into a conflict, not a write', async () => {
    const { commands, written } = setUp(mission(), [run('open')]);

    const result = await commands.run('m1', { action: 'another-run', yardId: HERE }, OPERATOR);

    expect(result).toMatchObject({ ok: false, failure: 'conflict' });
    expect(written).toEqual([]);
  });

  it('refuses a link the learner player could not embed, before anything else', async () => {
    const { commands, written } = setUp(mission({ status: 'completed' }), [
      run('done', { status: 'completed' }),
    ]);

    const result = await commands.run(
      'm1',
      { action: 'attach-video', yardId: HERE, url: 'https://example.com/my-video' },
      OPERATOR,
    );

    expect(result).toMatchObject({ ok: false, failure: 'invalid' });
    expect(written).toEqual([]);
  });

  it.each([
    ['missing', null],
    ['deleted', mission({ deleted: true } as Partial<Mission>)],
  ])('reports a %s mission as not found', async (_label, found) => {
    const { commands } = setUp(found);

    const result = await commands.run('m1', { action: 'complete', yardId: HERE }, OPERATOR);

    expect(result).toMatchObject({ ok: false, failure: 'not-found' });
  });
});

describe("the learner's email", () => {
  it('is sent when a mission completes', async () => {
    const { commands, emailed } = setUp(mission(), [run('today')]);

    const result = await commands.run('m1', { action: 'complete', yardId: HERE }, OPERATOR);

    expect(emailed).toEqual(['completed']);
    expect(result).toMatchObject({ ok: true, notification: { sent: true } });
  });

  it('is not sent for a decision that does not complete the mission', async () => {
    const { commands, emailed } = setUp(mission(), [run('today')]);

    const result = await commands.run('m1', { action: 'cancel', yardId: HERE }, OPERATOR);

    expect(emailed).toEqual([]);
    expect(result).toMatchObject({ ok: true, status: 'cancelled', notification: null });
  });

  it('failing does not undo the decision the operator made', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken: LearnerNotifier = {
      notifyStatusChange: async () => {
        throw new Error('Resend is down');
      },
    };
    const { commands, written } = setUp(mission(), [run('today')], broken);

    const result = await commands.run('m1', { action: 'complete', yardId: HERE }, OPERATOR);

    expect(result).toMatchObject({ ok: true, status: 'completed', notification: null });
    expect(written).toHaveLength(1);
    error.mockRestore();
  });
});

describe('deleting', () => {
  it('soft-deletes a run at this yard, recording who and when', async () => {
    const { commands, deletedRuns, written } = setUp(mission(), [run('mine')]);

    const result = await commands.run('m1', { action: 'delete-run', yardId: HERE, runId: 'mine' }, OPERATOR);

    expect(result).toEqual({ ok: true, missionId: 'm1' });
    expect(deletedRuns).toEqual([['m1', 'mine', NOW.toISOString(), 'op@uct.ac.za']]);
    expect(written).toEqual([]);
  });

  it("will not delete another yard's run", async () => {
    const { commands, deletedRuns } = setUp(mission(), [run('theirs', { yardId: 'durban' })]);

    const result = await commands.run('m1', { action: 'delete-run', yardId: HERE, runId: 'theirs' }, OPERATOR);

    expect(result).toMatchObject({ ok: false, failure: 'forbidden' });
    expect(deletedRuns).toEqual([]);
  });

  it('soft-deletes a mission once, and calls a second attempt a conflict', async () => {
    const first = setUp(mission());
    await expect(first.commands.deleteMission('m1', { name: 'admin@uct.ac.za' }))
      .resolves.toEqual({ ok: true, missionId: 'm1' });
    expect(first.deletedMissions).toEqual([['m1', NOW.toISOString(), 'admin@uct.ac.za']]);

    const again = setUp(mission({ deleted: true } as Partial<Mission>));
    await expect(again.commands.deleteMission('m1', { name: 'admin@uct.ac.za' }))
      .resolves.toMatchObject({ ok: false, failure: 'conflict' });
    expect(again.deletedMissions).toEqual([]);
  });
});
