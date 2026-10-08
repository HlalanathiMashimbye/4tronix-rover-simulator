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
  /** Present when the target is a shape to draw: how far a run may stray from path. */
  matchWithinCm: number | null;
  /** Present when the target is a place to reach: where it is, and how close counts. */
  goal: (TargetPoint & { radiusCm: number }) | null;
}

export function targetGeometry(target: ChallengeTarget): TargetGeometry {
  const path = simulateCommands(target.commands).map(({ x, y }) => ({ x, y }));
  const end = path[path.length - 1];
  return {
    path,
    matchWithinCm: target.matchWithinCm ?? null,
    goal: target.arriveWithinCm !== undefined && end ? { ...end, radiusCm: target.arriveWithinCm } : null,
  };
}

/**
 * The furthest any point of `from` is from the nearest point of `to`, with
 * `to` treated as the line through its points rather than the points alone -
 * the simulator samples every 0.1s, so on a slow spin two samples can be a
 * long way apart along a straight edge.
 */
function furthestFrom(from: TargetPoint[], to: TargetPoint[]): number {
  let worst = 0;
  for (const p of from) {
    let nearest = Infinity;
    for (let i = 0; i < to.length; i++) {
      const a = to[i];
      const b = to[Math.min(i + 1, to.length - 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
      nearest = Math.min(nearest, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

/** Whether a run drew the target's path, within `withinCm` both ways (see 'matches-target'). */
export function followsPath(run: TargetPoint[], path: TargetPoint[], withinCm: number): boolean {
  if (run.length < 2 || path.length < 2) return false;
  return furthestFrom(run, path) <= withinCm && furthestFrom(path, run) <= withinCm;
}

/**
 * How a run that does not follow the path misses it, for feedback that names
 * what is wrong without saying how to fix it (AB#448): 'incomplete' when the
 * whole run lies on the shape but leaves part of it undrawn, 'off-shape' when
 * part of the run strays from it. null when it follows the path.
 */
export function pathMismatch(
  run: TargetPoint[],
  path: TargetPoint[],
  withinCm: number,
): 'incomplete' | 'off-shape' | null {
  if (followsPath(run, path, withinCm)) return null;
  return run.length >= 2 && furthestFrom(run, path) <= withinCm ? 'incomplete' : 'off-shape';
}

/**
 * Where a run that missed the goal stopped, relative to the target's route
 * (AB#448): 'short' on the route before the goal, 'past' beyond the goal
 * along the route's last leg, 'elsewhere' off the route altogether. Measured
 * against the route rather than as a distance from the start, which would
 * tell a rover that turned the wrong way it had "gone past".
 */
export function missedGoal(end: TargetPoint, path: TargetPoint[], radiusCm: number): 'short' | 'past' | 'elsewhere' {
  if (path.length >= 2 && furthestFrom([end], path) <= radiusCm) return 'short';
  // The last leg, from the last point that is not the goal itself.
  const goal = path[path.length - 1];
  const from = [...path].reverse().find((p) => Math.hypot(p.x - goal.x, p.y - goal.y) > 1);
  if (goal && from) {
    const dx = goal.x - from.x;
    const dy = goal.y - from.y;
    const length = Math.hypot(dx, dy);
    const along = ((end.x - goal.x) * dx + (end.y - goal.y) * dy) / length;
    const across = Math.abs((end.x - goal.x) * dy - (end.y - goal.y) * dx) / length;
    if (along > 0 && across <= radiusCm) return 'past';
  }
  return 'elsewhere';
}

/** Whether a run that ended at `end` stopped on the goal. */
export function endsOnGoal(end: TargetPoint, goal: TargetGeometry['goal']): boolean {
  if (!goal) return false;
  return Math.hypot(end.x - goal.x, end.y - goal.y) <= goal.radiusCm;
}
