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
  decideResolve,
  effectiveStatus,
  type RunSnapshot,
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
