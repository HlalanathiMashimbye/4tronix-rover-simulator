/**
 * The Mission entity: what an operator may do to a mission from a desk, and
 * how a new one starts. These rules are why the operator card and the server
 * cannot disagree about what state a mission is in.
 */

import { Mission, type MissionRecord, type MissionStatus } from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

const YARD = 'curiosity';

interface Setup {
  /** The operator's run at YARD, or null when that yard never wrote one. */
  runStatus?: MissionStatus | null;
  missionStatus?: MissionStatus;
  needsReview?: boolean;
}

function record(over: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: 'm1', yardId: YARD, learnerRef: 'ref', sessionId: 's', code: 'rover.forward(60)',
    status: 'queued', submittedAt: '2026-10-25T10:00:00.000Z', ...over,
  };
}

function run(over: Partial<MissionRun> = {}): MissionRun {
  return { runId: 'r1', yardId: YARD, status: 'queued', ...over };
}

function mission({ runStatus = 'queued', missionStatus = 'queued', needsReview = false }: Setup = {}): Mission {
  return runStatus === null
    ? Mission.restore(record({ status: missionStatus, needsReview }))
    : Mission.restore(record({ status: missionStatus }), [run({ status: runStatus, needsReview })]);
}

describe('which status an operator is acting on', () => {
  it('uses the run, because it is the record of an actual attempt', () => {
    expect(mission({ runStatus: 'processing', missionStatus: 'queued' }).statusAt(YARD)).toBe(
      'processing',
    );
  });

  it('falls back to the mission when the yard never reached Firestore', () => {
    // The offline-yard case, and the whole reason bookkeeping moved to the
    // desk. A satellite with no network never flushes its run outbox, so a
    // mission somebody ran by hand exists only in that Pi's SQLite. The desk
    // still has to be able to settle it.
    expect(mission({ runStatus: null, missionStatus: 'queued' }).statusAt(YARD)).toBe('queued');
  });
});

describe('complete', () => {
  it('settles a queued mission', () => {
    expect(mission().complete(YARD)).toEqual({
      ok: true,
      change: { status: 'completed', clearsReview: true },
    });
  });

  it('settles a mission whose run only exists on an offline satellite', () => {
    const result = mission({ runStatus: null }).complete(YARD);
    expect(result.ok).toBe(true);
  });

  it('refuses a mission that already settled', () => {
    const result = mission({ runStatus: 'completed' }).complete(YARD);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('already completed') });
  });
});

describe('cancel', () => {
  it('takes a queued mission out of the queue', () => {
    expect(mission().cancel(YARD)).toEqual({
      ok: true,
      change: { status: 'cancelled', clearsReview: true },
    });
  });

  it('clears a run stuck in processing, which is the case it exists for', () => {
    // A yard that lost signal mid-mission leaves a run in 'processing' forever.
    // Refusing here would make it unresolvable from anywhere, which is the
    // stuck-mission entry in the runbook. Cancelling records an outcome and
    // reaches no rover.
    const result = mission({ runStatus: 'processing' }).cancel(YARD);
    expect(result).toEqual({ ok: true, change: { status: 'cancelled', clearsReview: true } });
  });

  it('refuses a mission that already settled', () => {
    expect(mission({ runStatus: 'cancelled' }).cancel(YARD).ok).toBe(false);
  });
});

describe('attach video', () => {
  it('accepts a completed run', () => {
    expect(mission({ runStatus: 'completed' }).attachVideo(YARD)).toEqual({
      ok: true,
      change: { status: null, clearsReview: false },
    });
  });

  it('leaves the status alone, because a link is not a state change', () => {
    const result = mission({ runStatus: 'completed' }).attachVideo(YARD);
    expect(result.ok && result.change.status).toBeNull();
  });

  it('refuses an unfinished run', () => {
    // Otherwise a learner could watch a video for a mission still showing as
    // Pending. It also matches the order the work happens in: complete it,
    // download the recording, upload it, come back with a link.
    expect(mission({ runStatus: 'processing' }).attachVideo(YARD)).toEqual({
      ok: false,
      error: expect.stringContaining('Mark the mission complete'),
    });
  });
});

describe('resolve a review', () => {
  it('completes a mission the operator confirmed had run', () => {
    expect(mission({ needsReview: true }).resolve(YARD, 'completed')).toEqual({
      ok: true,
      change: { status: 'completed', clearsReview: true },
    });
  });

  it('puts a mission back in the queue without dispatching it', () => {
    // 'requeue' makes it available for a human to send again. Nothing in this
    // entity moves a rover, this branch included.
    expect(mission({ needsReview: true }).resolve(YARD, 'requeue')).toEqual({
      ok: true,
      change: { status: 'queued', clearsReview: true },
    });
  });

  it('refuses a mission nobody flagged', () => {
    expect(mission({ needsReview: false }).resolve(YARD, 'completed').ok).toBe(false);
  });

  it('resolves a run flagged on a satellite that is now offline', () => {
    // recovery.py raises the flag and rolls it onto the mission. If the run
    // document never made it to Firestore, the flag on the mission is all the
    // desk can see, and it has to be enough.
    const result = mission({ runStatus: null, needsReview: true }).resolve(YARD, 'completed');
    expect(result.ok).toBe(true);
  });
});

describe('leaving a note for the learner', () => {
  it('allows it on a run that finished', () => {
    expect(mission({ runStatus: 'completed' }).leaveFeedback(YARD).ok).toBe(true);
  });

  it('allows it on a run that FAILED, which is when it matters most', () => {
    /**
     * A mission that did not work is the one a child most needs a sentence
     * about. The learner-facing status still reads Pending rather than Failed
     * (that rule lives in discoveryStatus and is unchanged), so this note is
     * the only channel through which "the turn was too small, try 90 degrees"
     * can reach them at all.
     */
    expect(mission({ runStatus: 'failed' }).leaveFeedback(YARD).ok).toBe(true);
  });

  it('refuses on a run that has not happened yet', () => {
    // A comment on something nobody has watched, which the learner would open
    // as a verdict on a run that has not occurred.
    for (const runStatus of ['queued', 'processing'] as const) {
      const decision = mission({ runStatus }).leaveFeedback(YARD);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.error).toMatch(/before leaving feedback/i);
    }
  });

  it('changes no status: a note is not a state change', () => {
    const decision = mission({ runStatus: 'completed' }).leaveFeedback(YARD);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.change.status).toBeNull();
      expect(decision.change.clearsReview).toBe(false);
    }
  });
});

describe('logging another run', () => {
  /**
   * The yard keeps every attempt's video - recordings are named
   * <mission>__<yard>__<stamp>.mp4 so a re-run cannot overwrite the first.
   * Mission Control could not keep pace: a run was only created when an
   * operator marked a mission complete, and complete() refuses once it is
   * settled, so a mission had exactly one run per yard forever and the second
   * video had nothing to attach to.
   */
  it('is allowed once the current run has settled', () => {
    for (const status of ['completed', 'cancelled', 'failed'] as const) {
      const decision = mission({ runStatus: status, missionStatus: status }).logAnotherRun(YARD);
      expect(decision).toEqual({
        ok: true,
        change: { status: 'completed', clearsReview: true },
      });
    }
  });

  it('is refused while the current run is still open', () => {
    // Two live runs of one mission at one yard is not a thing that happens,
    // and recording it would put the queue into a state nobody can read.
    for (const status of ['queued', 'processing'] as const) {
      const decision = mission({ runStatus: status, missionStatus: status }).logAnotherRun(YARD);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.error).toContain(status);
    }
  });

  it('records the new run as completed, not queued', () => {
    // An operator logs it after watching it finish; a run that did not finish
    // produces no video and needs no record. It also has to carry a
    // completedAt, which the repository only stamps for 'completed', because
    // that is what runToLink orders candidates by.
    const decision = mission({ runStatus: 'completed', missionStatus: 'completed' }).logAnotherRun(YARD);

    expect(decision.ok && decision.change.status).toBe('completed');
  });

  it('falls back to the mission when the yard never wrote a run', () => {
    // The offline-yard case.
    const decision = mission({ runStatus: null, missionStatus: 'completed' }).logAnotherRun(YARD);

    expect(decision.ok).toBe(true);
  });
});

describe('a new mission', () => {
  it('starts queued, stamped with when it arrived, whatever the caller brings', () => {
    const fields = { ...record(), status: 'completed', submittedAt: 'yesterday' } as unknown as Parameters<typeof Mission.submit>[0];
    const fresh = Mission.submit(fields, new Date('2026-10-25T12:00:00.000Z'));

    expect(fresh.status).toBe('queued');
    expect(fresh.submittedAt).toBe('2026-10-25T12:00:00.000Z');
  });
});

describe('which run an operator is acting on', () => {
  it('is the latest at their yard, not the first stored', () => {
    const m = Mission.restore(record({ status: 'completed' }), [
      run({ runId: 'old', status: 'completed', startedAt: '2026-10-20T10:00:00Z' }),
      run({ runId: 'new', status: 'processing', startedAt: '2026-10-25T10:00:00Z' }),
    ]);

    expect(m.latestRunAt(YARD)?.runId).toBe('new');
    expect(m.complete(YARD).ok).toBe(true);
  });

  it("ignores another yard's run", () => {
    const m = Mission.restore(record({ status: 'queued' }), [run({ yardId: 'elsewhere', status: 'completed' })]);

    expect(m.statusAt(YARD)).toBe('queued');
    expect(m.attachVideo(YARD).ok).toBe(false);
  });
});

describe('what the entity hands out', () => {
  it('is a copy: changing it does not change the mission', () => {
    const m = mission({ missionStatus: 'queued' });
    const copy = m.toRecord();
    copy.status = 'completed';

    expect(m.status).toBe('queued');
    expect(m.complete(YARD).ok).toBe(true);
  });

  it('keeps its own copy of what it was restored from', () => {
    const stored = record({ status: 'queued' });
    const m = Mission.restore(stored);
    stored.status = 'cancelled';

    expect(m.status).toBe('queued');
  });
});

describe('still needs a video', () => {
  it('is a completed run with no link, and nothing else', () => {
    expect(Mission.stillNeedsVideo({ status: 'completed' })).toBe(true);
    expect(Mission.stillNeedsVideo({ status: 'completed', youtubeUrl: 'https://youtu.be/RNm4VtDxIPE' })).toBe(false);
    expect(Mission.stillNeedsVideo({ status: 'cancelled' })).toBe(false);
  });
});
