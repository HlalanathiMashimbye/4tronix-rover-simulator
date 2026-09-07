/**
 * The rules behind the operator's five desk actions (AB#379).
 *
 * These are the part worth testing: they encode what an operator is allowed to
 * do to a mission, and they are the reason the cloud console and the yard
 * console cannot drift into disagreeing about what state something is in.
 */

import {
  decideAttachVideo,
  decideCancel,
  decideComplete,
  decideFeedback,
  decideResolve,
  effectiveStatus,
  type RunSnapshot,
  decideAnotherRun,
} from '@/core/domain/services/missionBookkeeping';

function snapshot(over: Partial<RunSnapshot> = {}): RunSnapshot {
  return { runStatus: 'queued', missionStatus: 'queued', needsReview: false, ...over };
}

describe('which status an operator is acting on', () => {
  it('uses the run, because it is the record of an actual attempt', () => {
    expect(effectiveStatus(snapshot({ runStatus: 'processing', missionStatus: 'queued' }))).toBe(
      'processing',
    );
  });

  it('falls back to the mission when the yard never reached Firestore', () => {
    // The offline-yard case, and the whole reason bookkeeping moved to the
    // desk. A satellite with no network never flushes its run outbox, so a
    // mission somebody ran by hand exists only in that Pi's SQLite. The desk
    // still has to be able to settle it.
    expect(effectiveStatus(snapshot({ runStatus: null, missionStatus: 'queued' }))).toBe('queued');
  });
});

describe('complete', () => {
  it('settles a queued mission', () => {
    expect(decideComplete(snapshot())).toEqual({
      ok: true,
      change: { status: 'completed', clearsReview: true },
    });
  });

  it('settles a mission whose run only exists on an offline satellite', () => {
    const result = decideComplete(snapshot({ runStatus: null }));
    expect(result.ok).toBe(true);
  });

  it('refuses a mission that already settled', () => {
    const result = decideComplete(snapshot({ runStatus: 'completed' }));
    expect(result).toEqual({ ok: false, error: expect.stringContaining('already completed') });
  });
});

describe('cancel', () => {
  it('takes a queued mission out of the queue', () => {
    expect(decideCancel(snapshot())).toEqual({
      ok: true,
      change: { status: 'cancelled', clearsReview: true },
    });
  });

  it('clears a run stuck in processing, which is the case it exists for', () => {
    // A yard that lost signal mid-mission leaves a run in 'processing' forever.
    // Refusing here would make it unresolvable from anywhere, which is the
    // stuck-mission entry in the runbook. Cancelling records an outcome and
    // reaches no rover.
    const result = decideCancel(snapshot({ runStatus: 'processing' }));
    expect(result).toEqual({ ok: true, change: { status: 'cancelled', clearsReview: true } });
  });

  it('refuses a mission that already settled', () => {
    expect(decideCancel(snapshot({ runStatus: 'cancelled' })).ok).toBe(false);
  });
});

describe('attach video', () => {
  it('accepts a completed run', () => {
    expect(decideAttachVideo(snapshot({ runStatus: 'completed' }))).toEqual({
      ok: true,
      change: { status: null, clearsReview: false },
    });
  });

  it('leaves the status alone, because a link is not a state change', () => {
    const result = decideAttachVideo(snapshot({ runStatus: 'completed' }));
    expect(result.ok && result.change.status).toBeNull();
  });

  it('refuses an unfinished run', () => {
    // Otherwise a learner could watch a video for a mission still showing as
    // Pending. It also matches the order the work happens in: complete it,
    // download the recording, upload it, come back with a link.
    expect(decideAttachVideo(snapshot({ runStatus: 'processing' }))).toEqual({
      ok: false,
      error: expect.stringContaining('Mark the mission complete'),
    });
  });
});

describe('resolve a review', () => {
  it('completes a mission the operator confirmed had run', () => {
    expect(decideResolve(snapshot({ needsReview: true }), 'completed')).toEqual({
      ok: true,
      change: { status: 'completed', clearsReview: true },
    });
  });

  it('puts a mission back in the queue without dispatching it', () => {
    // 'requeue' makes it available for a human to send again. Nothing in this
    // module moves a rover, this branch included.
    expect(decideResolve(snapshot({ needsReview: true }), 'requeue')).toEqual({
      ok: true,
      change: { status: 'queued', clearsReview: true },
    });
  });

  it('refuses a mission nobody flagged', () => {
    expect(decideResolve(snapshot({ needsReview: false }), 'completed').ok).toBe(false);
  });

  it('resolves a run flagged on a satellite that is now offline', () => {
    // recovery.py raises the flag and rolls it onto the mission. If the run
    // document never made it to Firestore, the flag on the mission is all the
    // desk can see, and it has to be enough.
    const result = decideResolve(snapshot({ runStatus: null, needsReview: true }), 'completed');
    expect(result.ok).toBe(true);
  });
});

describe('leaving a note for the learner', () => {
  it('allows it on a run that finished', () => {
    expect(decideFeedback(snapshot({ runStatus: 'completed' })).ok).toBe(true);
  });

  it('allows it on a run that FAILED, which is when it matters most', () => {
    /**
     * A mission that did not work is the one a child most needs a sentence
     * about. The learner-facing status still reads Pending rather than Failed
     * (that rule lives in discoveryStatus and is unchanged), so this note is
     * the only channel through which "the turn was too small, try 90 degrees"
     * can reach them at all.
     */
    expect(decideFeedback(snapshot({ runStatus: 'failed' })).ok).toBe(true);
  });

  it('refuses on a run that has not happened yet', () => {
    // A comment on something nobody has watched, which the learner would open
    // as a verdict on a run that has not occurred.
    for (const runStatus of ['queued', 'processing'] as const) {
      const decision = decideFeedback(snapshot({ runStatus }));
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.error).toMatch(/before leaving feedback/i);
    }
  });

  it('changes no status: a note is not a state change', () => {
    const decision = decideFeedback(snapshot({ runStatus: 'completed' }));
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
   * operator marked a mission complete, and decideComplete refuses once it is
   * settled, so a mission had exactly one run per yard forever and the second
   * video had nothing to attach to.
   */
  it('is allowed once the current run has settled', () => {
    for (const status of ['completed', 'cancelled', 'failed'] as const) {
      const decision = decideAnotherRun({
        runStatus: status, missionStatus: status, needsReview: false,
      });
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
      const decision = decideAnotherRun({
        runStatus: status, missionStatus: status, needsReview: false,
      });
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.error).toContain(status);
    }
  });

  it('records the new run as completed, not queued', () => {
    // An operator logs it after watching it finish; a run that did not finish
    // produces no video and needs no record. It also has to carry a
    // completedAt, which the repository only stamps for 'completed', because
    // that is what runToLink orders candidates by.
    const decision = decideAnotherRun({
      runStatus: 'completed', missionStatus: 'completed', needsReview: false,
    });

    expect(decision.ok && decision.change.status).toBe('completed');
  });

  it('falls back to the mission when the yard never wrote a run', () => {
    // The offline-yard case the rest of this file exists for.
    const decision = decideAnotherRun({
      runStatus: null, missionStatus: 'completed', needsReview: false,
    });

    expect(decision.ok).toBe(true);
  });
});
