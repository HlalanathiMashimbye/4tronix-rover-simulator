import { STEP_SECONDS, type TrajectoryPoint } from '@/lib/simulateCommands';

/**
 * How long a mission takes, for the Duration stat under the player.
 *
 * IT USED TO READ A FIELD NOTHING WRITES.
 *
 * The page read `mission.executionMetadata.duration_ms`. That key is present
 * on ZERO of 121 mission documents, so the stat could only ever say "Not yet"
 * - including on a completed mission with footage of the rover driving, which
 * is the exact moment a child looks at it.
 *
 * THE TIMESTAMPS ALONE ARE NOT USABLE EITHER.
 *
 * 72 runs carry both startedAt and completedAt, and subtracting them gives
 * real answers for some and nonsense for others. Measured on live data:
 *
 *     Desert Collector       13s      plausible
 *     Storm Traveler         17s      plausible
 *     Canyon Explorer   -135924s      completedAt precedes startedAt
 *     Mars Explorer      357220s      99 hours, left processing overnight
 *
 * A negative duration is a broken record. A 99-hour one is bookkeeping lag -
 * how long before someone marked it complete, not how long a rover drove.
 * Neither is a thing to show a nine-year-old.
 *
 * SO: the program's own length is the floor, and a real measurement is used
 * only when it is credible. The trajectory is one point every STEP_SECONDS, so
 * its length is exactly how long the mission the child wrote takes to run, is
 * available for every mission, and is what they watch in the simulator.
 */

/** Beyond this, a "duration" is a record of when someone did paperwork. */
const IMPLAUSIBLE_SECONDS = 15 * 60;

export function programmedSeconds(trajectory: TrajectoryPoint[]): number {
  return trajectory.length * STEP_SECONDS;
}

/**
 * Seconds between two timestamps, or null when the pair cannot be believed.
 *
 * Rejects missing halves, unparseable dates, negatives, and anything long
 * enough to be a mission left open rather than a rover driving.
 */
export function measuredSeconds(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | null {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const seconds = (end - start) / 1000;
  if (seconds <= 0 || seconds > IMPLAUSIBLE_SECONDS) return null;

  return seconds;
}

/** "8s", "1m 12s". Short enough for a stat tile. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds));
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * What to show, given the run being watched.
 *
 * A real run shows what it actually took, when that is credible. Everything
 * else - the simulation, and a real run whose record is not believable - shows
 * how long the program itself runs, which is true of every mission and is
 * never absent.
 */
export function durationLabel(
  trajectory: TrajectoryPoint[],
  run?: { kind: 'sim' | 'real'; startedAt?: string | null; completedAt?: string | null },
): string {
  if (run?.kind === 'real') {
    const measured = measuredSeconds(run.startedAt, run.completedAt);
    if (measured !== null) return formatDuration(measured);
  }

  const programmed = programmedSeconds(trajectory);
  // A mission with no parseable commands has no length to report. Saying so
  // beats printing "0s", which looks like a rover that never moved.
  return programmed > 0 ? formatDuration(programmed) : '—';
}
