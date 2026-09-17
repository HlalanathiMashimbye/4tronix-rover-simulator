import { isDue, linkerStatus, nextCheckAfter } from '@/core/domain/services/youtubeLinkSchedule';

const at = (hhmmss: string) => new Date(`2026-09-17T${hhmmss}Z`);

describe('nextCheckAfter', () => {
  it('is the next quarter hour on the clock when every call does work', () => {
    expect(nextCheckAfter(at('13:00:10'), 15, at('13:02:00'))).toEqual(at('13:15:00'));
  });

  it('moves on from a tick that has just happened', () => {
    expect(nextCheckAfter(at('13:15:08'), 15, at('13:15:00'))).toEqual(at('13:30:00'));
  });

  it('skips the calls a longer admin interval leaves idle', () => {
    // Checked at 13:00, every 60 minutes: 13:15, 13:30 and 13:45 do nothing.
    expect(nextCheckAfter(at('13:00:10'), 60, at('13:02:00'))).toEqual(at('14:00:00'));
  });

  it('is the very next call when nothing has ever been checked', () => {
    expect(nextCheckAfter(null, 60, at('13:07:00'))).toEqual(at('13:15:00'));
  });
});

describe('linkerStatus', () => {
  it('says so when the channel has never been read', () => {
    expect(linkerStatus(null, 15, at('13:00:00'))).toEqual({ state: 'never' });
  });

  it('is on schedule between checks, with the next one named', () => {
    expect(linkerStatus(at('13:00:10'), 15, at('13:09:00'))).toEqual({
      state: 'on-schedule',
      lastCheckedAt: at('13:00:10'),
      nextCheckAt: at('13:15:00'),
    });
  });

  it('allows a check a few minutes to land before calling it overdue', () => {
    expect(linkerStatus(at('13:00:10'), 15, at('13:19:00')).state).toBe('on-schedule');
  });

  it('is overdue once a check that should have happened has not', () => {
    /**
     * The case that went a week unnoticed. A check is only recorded after
     * YouTube has actually been read, so an unset or revoked key stops the
     * timestamp moving, and this is what that looks like.
     */
    expect(linkerStatus(at('13:00:10'), 15, at('13:21:00'))).toEqual({
      state: 'overdue',
      lastCheckedAt: at('13:00:10'),
      expectedAt: at('13:15:00'),
    });
  });

  it('does not call a long admin interval overdue before its time', () => {
    expect(linkerStatus(at('13:00:10'), 60, at('13:50:00')).state).toBe('on-schedule');
  });
});

describe('isDue', () => {
  it('lives beside the status line, which must agree with the throttle', () => {
    expect(isDue(null, 15)).toBe(true);
    expect(isDue(at('13:00:10'), 15, at('13:10:00'))).toBe(false);
    expect(isDue(at('13:00:10'), 15, at('13:15:00'))).toBe(true);
  });
});
