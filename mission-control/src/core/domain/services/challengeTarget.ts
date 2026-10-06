/**
 * Where a challenge's target is, worked out from its reference program.
 *
 * The one place a target becomes coordinates. The simulator draws from it
 * (AB#447) and the 'reaches-target' check measures against it (AB#453), so
 * the marker a learner aims at and the spot the check accepts cannot drift
 * apart: they are the same numbers.
 */

import type { ChallengeTarget } from '@/core/domain/entities/Challenge';
import { simulateCommands } from '@/lib/simulateCommands';

/** A point in the rover's own frame, in cm: x to its right, y ahead, from the start mark. */
export interface TargetPoint {
  x: number;
  y: number;
}

export interface TargetGeometry {
  /** The path the reference program drives, start to finish. */
  path: TargetPoint[];
  /** Present when the target is a place to reach: where it is, and how close counts. */
  goal: (TargetPoint & { radiusCm: number }) | null;
}

export function targetGeometry(target: ChallengeTarget): TargetGeometry {
  const path = simulateCommands(target.commands).map(({ x, y }) => ({ x, y }));
  const end = path[path.length - 1];
  return {
    path,
    goal: target.arriveWithinCm !== undefined && end ? { ...end, radiusCm: target.arriveWithinCm } : null,
  };
}

/** Whether a run that ended at `end` stopped on the goal. */
export function endsOnGoal(end: TargetPoint, goal: TargetGeometry['goal']): boolean {
  if (!goal) return false;
  return Math.hypot(end.x - goal.x, end.y - goal.y) <= goal.radiusCm;
}
