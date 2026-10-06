/**
 * When the YouTube linker runs, and whether it is keeping to that.
 *
 * Cloud Scheduler calls the linker on a fixed cadence, on the clock, and the
 * admin-set interval decides how many of those calls do any work. Both halves
 * were only ever known to the server, so an operator could not tell a linker
 * that was working from one that had never run: on staging it went a week
 * doing nothing, because its YouTube key was unset, and nothing anywhere said
 * so.
 *
 * Pure, so the operator's status line and the linker's own throttle read the
 * same rule, and so it tests without a clock, a scheduler or Firestore.
 */

/**
 * Minutes between Cloud Scheduler calls. Terraform owns the real value
 * (`cron_schedule`, `*\/15`); cronScheduleAgreement.test.ts checks this still
 * matches it.
 */
export const SCHEDULER_CADENCE_MINUTES = 15;

/**
 * Slack allowed on the interval boundary, so that the time YouTube itself
 * takes to answer (the check is stamped only after that) does not shave the
 * elapsed time just under the threshold. Without it, an admin interval equal
 * to (or a multiple of) the scheduler's own cadence misses its exact tick
 * every time and silently checks at double the configured rate.
 */
const TOLERANCE_MS = 60_000;

/**
 * How long past its expected time a check may be before it is called overdue.
 * A call takes seconds, and a scheduler can fire a little late; five minutes
 * is well clear of both and well short of the next tick.
 */
const OVERDUE_GRACE_MS = 5 * 60_000;

/** Whether enough time has passed for another check to be due. */
export function isDue(last: Date | null, intervalMinutes: number, now: Date = new Date()): boolean {
  if (!last) return true;
  return now.getTime() - last.getTime() >= intervalMinutes * 60_000 - TOLERANCE_MS;
}

/** The first scheduler call strictly after `after`, on the clock. */
function nextTick(after: Date): Date {
  const cadence = SCHEDULER_CADENCE_MINUTES * 60_000;
  return new Date((Math.floor(after.getTime() / cadence) + 1) * cadence);
}

/**
 * The first scheduler call after `after` that the interval lets do any work.
 * Bounded: the interval is at most a day, which is 96 ticks.
 */
export function nextCheckAfter(last: Date | null, intervalMinutes: number, after: Date): Date {
  let tick = nextTick(after);
  for (let i = 0; i < 200 && !isDue(last, intervalMinutes, tick); i += 1) {
    tick = nextTick(tick);
  }
  return tick;
}

export type LinkerStatus =
  | { state: 'never' }
  | { state: 'on-schedule'; lastCheckedAt: Date; nextCheckAt: Date }
  | { state: 'overdue'; lastCheckedAt: Date; expectedAt: Date };

/**
 * What an operator should be told about the linker right now.
 *
 * OVERDUE IS THE SIGNAL THAT MATTERS. A check is only recorded once YouTube has
 * actually been read, so a linker with no key, a revoked key or a YouTube
 * outage stops recording. That shows here as a check that should have happened
 * and did not, without the linker writing anything more than it already does.
 */
export function linkerStatus(
  lastCheckedAt: Date | null,
  intervalMinutes: number,
  now: Date,
): LinkerStatus {
  if (!lastCheckedAt) return { state: 'never' };

  const expectedAt = nextCheckAfter(lastCheckedAt, intervalMinutes, lastCheckedAt);
  if (now.getTime() > expectedAt.getTime() + OVERDUE_GRACE_MS) {
    return { state: 'overdue', lastCheckedAt, expectedAt };
  }
  return { state: 'on-schedule', lastCheckedAt, nextCheckAt: nextCheckAfter(lastCheckedAt, intervalMinutes, now) };
}
