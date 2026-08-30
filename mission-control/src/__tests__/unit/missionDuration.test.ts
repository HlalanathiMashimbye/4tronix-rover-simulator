/**
 * The Duration stat.
 *
 * It read mission.executionMetadata.duration_ms, a key present on zero of 121
 * mission documents, so it always said "Not yet" - including under footage of
 * a rover that had plainly finished driving.
 */

import {
  durationLabel,
  formatDuration,
  measuredSeconds,
  programmedSeconds,
} from '@/lib/missionDuration';
import type { TrajectoryPoint } from '@/lib/simulateCommands';

const point = {} as TrajectoryPoint;
const trajectory = (seconds: number) => Array(Math.round(seconds / 0.1)).fill(point);

describe('a measurement is only used when it can be believed', () => {
  it('accepts a plausible run', () => {
    expect(measuredSeconds('2026-08-01T10:00:00Z', '2026-08-01T10:00:13Z')).toBe(13);
  });

  it('rejects a negative one', () => {
    // Live data: Canyon Explorer measured -135924s, completedAt before
    // startedAt. A broken record, not a fast rover.
    expect(measuredSeconds('2026-08-01T10:00:00Z', '2026-08-01T09:00:00Z')).toBeNull();
  });

  it('rejects one long enough to be paperwork rather than driving', () => {
    // Live data: Mars Explorer measured 357220s - 99 hours - because it sat
    // processing until somebody marked it complete.
    expect(measuredSeconds('2026-08-01T10:00:00Z', '2026-08-05T13:00:00Z')).toBeNull();
  });

  it('rejects a half-recorded run', () => {
    expect(measuredSeconds('2026-08-01T10:00:00Z', null)).toBeNull();
    expect(measuredSeconds(undefined, '2026-08-01T10:00:00Z')).toBeNull();
  });

  it('rejects timestamps it cannot parse', () => {
    expect(measuredSeconds('not a date', '2026-08-01T10:00:00Z')).toBeNull();
  });
});

describe('the programme itself always has a length', () => {
  it('reads it off the trajectory', () => {
    expect(programmedSeconds(trajectory(8))).toBeCloseTo(8);
  });
});

describe('what the learner sees', () => {
  it('shows what a real run actually took', () => {
    expect(
      durationLabel(trajectory(8), {
        kind: 'real',
        startedAt: '2026-08-01T10:00:00Z',
        completedAt: '2026-08-01T10:00:12Z',
      }),
    ).toBe('12s');
  });

  it('falls back to the programme when the record is not believable', () => {
    // Better a true statement about the mission than a negative number.
    expect(
      durationLabel(trajectory(8), {
        kind: 'real',
        startedAt: '2026-08-01T10:00:00Z',
        completedAt: '2026-08-01T09:00:00Z',
      }),
    ).toBe('8s');
  });

  it('shows the programme length for the simulation', () => {
    expect(durationLabel(trajectory(17), { kind: 'sim' })).toBe('17s');
  });

  it('never says "Not yet" for a mission that has a programme', () => {
    // The whole complaint: a completed mission with a video reading "Not yet".
    expect(durationLabel(trajectory(5), { kind: 'real' })).toBe('5s');
  });

  it('says nothing rather than 0s when there is no programme at all', () => {
    // "0s" reads as a rover that never moved.
    expect(durationLabel([], { kind: 'sim' })).toBe('—');
  });
});

describe('formatting', () => {
  it.each([
    [8, '8s'],
    [59, '59s'],
    [60, '1m'],
    [72, '1m 12s'],
    [125, '2m 5s'],
  ])('renders %ss as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('rounds a sub-second run up rather than showing 0s', () => {
    expect(formatDuration(0.4)).toBe('1s');
  });
});
