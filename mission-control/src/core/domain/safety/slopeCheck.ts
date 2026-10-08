/**
 * Whether a simulated run climbs rising ground, how steep, and when (AB#468).
 *
 * The one answer to that question, beside crashCheck's: the learner's
 * pre-flight checks, the operator's preview and the simulator's own words all
 * read it here.
 *
 * A slope is a warning, never a stop. The zones are drawn by eye and the
 * physics drives over them as if they were flat, so all the simulator knows is
 * that from that moment the real rover may not do what it shows: slip, drift
 * or stall. The learner is told and may still send it; even red, the peaks,
 * which the board card first meant to block, at the team's call on 6 Oct 2026.
 */

import type { TrajectoryPoint } from '@/lib/simulateCommands';
import { STEP_SECONDS } from '@/lib/simulateCommands';
import { ZONE_LEVELS, type ZoneLevel } from '@/lib/rover-physics';

export interface Slope {
  /** The steepest ground the run reaches. */
  level: ZoneLevel;
  /** Where in the trajectory it first gets there, and when, to the tenth. */
  frame: number;
  atSeconds: number;
}

export function findSlope(trajectory: Pick<TrajectoryPoint, 'zone'>[]): Slope | null {
  let steepest = -1;
  let frame = -1;
  trajectory.forEach((point, index) => {
    const rank = point.zone ? ZONE_LEVELS.indexOf(point.zone) : -1;
    if (rank > steepest) {
      steepest = rank;
      frame = index;
    }
  });
  if (steepest < 0) return null;
  return { level: ZONE_LEVELS[steepest], frame, atSeconds: Math.round(frame * STEP_SECONDS * 10) / 10 };
}
