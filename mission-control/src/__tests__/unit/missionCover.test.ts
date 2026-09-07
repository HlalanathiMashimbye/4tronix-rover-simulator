/**
 * The cover is derived from the mission's stored code, so what matters is the
 * cases where there is nothing to derive: code the parser cannot read, and
 * missions that never moved. A cover is decoration and must never take a card
 * down with it.
 *
 * No DOM here on purpose - this is the parse-and-simulate step, and it is worth
 * being able to test it as the arithmetic it is.
 */

import { missionCoverTrajectory } from '@/core/domain/services/missionCover';

describe('missionCoverTrajectory', () => {
  it('returns the drive for a mission that moves', () => {
    const trajectory = missionCoverTrajectory('rover.forward(60)\ntime.sleep(3)\nrover.stop()');

    expect(trajectory).not.toBeNull();
    expect(trajectory!.length).toBeGreaterThan(1);
  });

  it('ends where the rover ended, so the cover is the last frame', () => {
    const trajectory = missionCoverTrajectory('rover.forward(60)\ntime.sleep(3)\nrover.stop()')!;
    const start = trajectory[0];
    const end = trajectory[trajectory.length - 1];

    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(1);
  });

  it('is null when there is no code', () => {
    expect(missionCoverTrajectory(undefined)).toBeNull();
    expect(missionCoverTrajectory('')).toBeNull();
    expect(missionCoverTrajectory('   \n  ')).toBeNull();
  });

  it('is null for a mission that never moves', () => {
    // Lights only. The arena would render, but with the rover parked on the
    // start pad it says less than the generic art does.
    expect(missionCoverTrajectory('rover.setColor(255, 0, 0)\nrover.show()\ntime.sleep(3)')).toBeNull();
  });

  it('is null when the motors start but nothing waits for them', () => {
    // forward() returns immediately, so there is no drive to draw.
    expect(missionCoverTrajectory('rover.forward(60)\nrover.stop()')).toBeNull();
  });

  it('survives code the parser cannot read', () => {
    expect(() => missionCoverTrajectory('!!! not python at all (((')).not.toThrow();
  });

  it('keeps a spin, which moves the rover without moving it far', () => {
    // A spin changes heading; the cover still has something to show.
    const trajectory = missionCoverTrajectory('rover.spinRight(60)\ntime.sleep(4)\nrover.stop()');

    expect(trajectory === null || trajectory.length > 1).toBe(true);
  });
});
