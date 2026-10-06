/**
 * Whether a simulated run crashes, and where (AB#466).
 *
 * The one answer to that question. The learner's pre-flight checks ask it to
 * decide whether Send is allowed, and the operator's preview asks it to say
 * what a queued mission will do, so both read it here rather than each
 * scanning the trajectory its own way.
 *
 * A crash is the first frame the physics stopped the rover: at the edge of
 * the yard, or against a rock. Both are real: the simulator's yard is the
 * measured one, rocks and all (AB#464), and the real rover in either case
 * pushes, climbs or stalls until an operator rescues it.
 */

import type { TrajectoryPoint } from '@/lib/simulateCommands';
import { STEP_SECONDS, crashFrame } from '@/lib/simulateCommands';

export interface Crash {
  /** Seconds into the run, to the tenth a person reads. */
  atSeconds: number;
  into: 'wall' | 'rock';
  /** Which rock, for an operator who can see the yard. */
  rock?: string;
  /** Where in the trajectory, so a simulator can mark the spot. */
  frame: number;
}

export function findCrash(trajectory: TrajectoryPoint[]): Crash | null {
  const frame = crashFrame(trajectory);
  if (frame < 0) return null;
  const point = trajectory[frame];
  // Rounded to the tenth the words say: step 53 is 5.300000000000001 seconds
  // in floating point, and a time the message calls 5.3 should be 5.3.
  const atSeconds = Math.round(frame * STEP_SECONDS * 10) / 10;
  return point.hitRock
    ? { atSeconds, into: 'rock', rock: point.hitRock, frame }
    : { atSeconds, into: 'wall', frame };
}
