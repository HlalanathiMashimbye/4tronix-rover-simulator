/**
 * The trajectory behind a mission's cover image.
 *
 * Pure, and deliberately not inside the component that draws it: this is the
 * same parse-then-simulate the workspace does, and it is worth being able to
 * test without standing up a DOM. An earlier version of this lived in the card
 * component, and its test had to boot jsdom and renderHook to check arithmetic.
 */

import { parseRoverCode } from '@/lib/parseRoverCode';
import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';

/**
 * What the simulator would show for this mission, or null if there is nothing
 * worth showing.
 *
 * Null rather than an empty array for anything that does not describe a drive -
 * unreadable code, a mission that only sets the lights, a program that never
 * moves. The card falls back to its generic art, which is the honest picture of
 * "there is nothing to show here".
 */
export function missionCoverTrajectory(code: string | undefined): TrajectoryPoint[] | null {
  if (!code?.trim()) return null;

  let trajectory: TrajectoryPoint[];
  try {
    trajectory = simulateCommands(parseRoverCode(code));
  } catch {
    // This runs against whatever is on the mission document, including code
    // written before the parser understood it. A cover is decoration; it must
    // never take a card down with it.
    return null;
  }

  if (trajectory.length < 2) return null;

  // A mission that went nowhere - lights only, or a drive with no pause after
  // it. The arena would render, but with the rover parked on the start pad it
  // says less than the generic art does.
  const moved = trajectory.some(
    (point) => Math.abs(point.x - trajectory[0].x) > 0.01 || Math.abs(point.y - trajectory[0].y) > 0.01,
  );

  return moved ? trajectory : null;
}
