/**
 * Run semantics: a mission is a program, a run is one yard's attempt at it.
 *
 * These are the rules the learner's mission page and the dispatch guard both
 * depend on, so they are pinned here rather than rediscovered in each caller.
 */

import {
  hasVideo,
  watchableRuns,
  isCompletedAnywhere,
  isRunningAt,
  type MissionRun,
} from '@/core/domain/entities/MissionRun';

const run = (over: Partial<MissionRun> & { yardId: string }): MissionRun => ({
  status: 'completed',
  ...over,
});

describe('watchableRuns', () => {
  it('lists only yards whose attempt produced a video', () => {
    const runs = [
      run({ yardId: 'curiosity', youtubeUrl: 'https://youtu.be/a' }),
      run({ yardId: 'durban-1' }),
    ];

    expect(watchableRuns(runs).map((r) => r.yardId)).toEqual(['curiosity']);
  });

  it('leaves a failed run out rather than showing it as failed', () => {
    // A learner never sees "Failed". Under per-yard runs that rule survives by
    // omission: the yard that went wrong is simply not in the selector.
    const runs = [
      run({ yardId: 'curiosity', status: 'failed' }),
      run({ yardId: 'durban-1', youtubeUrl: 'https://youtu.be/b' }),
    ];

    expect(watchableRuns(runs).map((r) => r.yardId)).toEqual(['durban-1']);
  });

  it('orders newest first, so the latest attempt is the default', () => {
    const runs = [
      run({ yardId: 'old', youtubeUrl: 'u', completedAt: '2026-08-01T00:00:00Z' }),
      run({ yardId: 'new', youtubeUrl: 'u', completedAt: '2026-08-20T00:00:00Z' }),
    ];

    expect(watchableRuns(runs).map((r) => r.yardId)).toEqual(['new', 'old']);
  });

  it('treats an empty youtubeUrl as no video', () => {
    expect(hasVideo(run({ yardId: 'a', youtubeUrl: '' }))).toBe(false);
  });

  it('returns nothing when no yard has run it yet', () => {
    expect(watchableRuns([])).toEqual([]);
  });
});

describe('isCompletedAnywhere', () => {
  it('is true when any yard finished it, even if another failed', () => {
    // The learner-facing status rolls up the runs: "somebody ran this and it
    // worked" is the only distinction a learner needs.
    const runs = [
      run({ yardId: 'a', status: 'failed' }),
      run({ yardId: 'b', status: 'completed' }),
    ];

    expect(isCompletedAnywhere(runs)).toBe(true);
  });

  it('is false while every attempt is still in flight', () => {
    expect(isCompletedAnywhere([run({ yardId: 'a', status: 'processing' })])).toBe(false);
  });

  it('is false with no runs at all', () => {
    expect(isCompletedAnywhere([])).toBe(false);
  });
});

describe('isRunningAt', () => {
  it('is true when this yard already has an attempt in flight', () => {
    // The entire duplicate-dispatch guard, and the reason no lock is needed.
    const runs = [run({ yardId: 'curiosity', status: 'processing' })];

    expect(isRunningAt(runs, 'curiosity')).toBe(true);
  });

  it('is false when a DIFFERENT yard is running it', () => {
    // Two yards running the same mission is a feature, not a race. This is the
    // assertion that stops someone reintroducing a cross-yard lock.
    const runs = [run({ yardId: 'durban-1', status: 'processing' })];

    expect(isRunningAt(runs, 'curiosity')).toBe(false);
  });

  it('is false once this yard finished, so a rerun is allowed', () => {
    const runs = [run({ yardId: 'curiosity', status: 'completed' })];

    expect(isRunningAt(runs, 'curiosity')).toBe(false);
  });
});
