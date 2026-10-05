/**
 * The simulator drives in the real yard (AB#464).
 *
 * The rover starts on the middle of the seam facing south, the front wall,
 * and the yard is drawn north up. Getting either the size or the direction
 * wrong would still draw a convincing yard, so these drive into each wall and
 * check which one stops it, and when.
 */

import { simulateCommands, STEP_SECONDS, type TrajectoryPoint } from '@/lib/simulateCommands';
import { YARD, roverToYard, yardToRover, spinSecondsForDegrees } from '@/lib/rover-physics';
import { computeLayout, worldToScreen } from '@/lib/roverSimRender';
import type { SimulationCommand } from '@/lib/roverBlockly';

const SPEED_60_CM_PER_SECOND = 9;

function drive(...commands: SimulationCommand[]): TrajectoryPoint[] {
  return simulateCommands(commands);
}

function endInYard(trajectory: TrajectoryPoint[]): [number, number] {
  const end = trajectory[trajectory.length - 1];
  return roverToYard(end.x, end.y);
}

function secondsUntilWall(trajectory: TrajectoryPoint[]): number {
  return trajectory.findIndex((point) => point.hitWall) * STEP_SECONDS;
}

/** The rover's centre stops short of a wall by about half its 20 cm body. */
function nearWall(position: number, wall: number) {
  expect(Math.abs(position - wall)).toBeGreaterThan(9);
  expect(Math.abs(position - wall)).toBeLessThan(15);
}

describe('the rover in the real yard', () => {
  it('starts on the middle of the seam', () => {
    const [x, y] = endInYard(drive());
    expect(x).toBeCloseTo(YARD.widthCm / 2, 6);
    expect(y).toBeCloseTo(121, 6);
  });

  it('drives forward south, to the front wall, in the time the distance takes', () => {
    const run = drive({ command: 'forward', speed: 60, duration: 20 });
    const [x, y] = endInYard(run);
    nearWall(y, YARD.depthCm);
    expect(x).toBeCloseTo(YARD.widthCm / 2, 6);
    // 128 cm from the seam to the wall, less the rover's half length.
    const expected = (YARD.depthCm - 121 - 12) / SPEED_60_CM_PER_SECOND;
    expect(Math.abs(secondsUntilWall(run) - expected)).toBeLessThan(0.2);
  });

  it('reverses north, to the backdrop', () => {
    const [x, y] = endInYard(drive({ command: 'reverse', speed: 60, duration: 20 }));
    nearWall(y, 0);
    expect(x).toBeCloseTo(YARD.widthCm / 2, 6);
  });

  it('turned right, heads west, towards the door', () => {
    const turn = spinSecondsForDegrees(90, 60);
    const [x, y] = endInYard(
      drive({ command: 'spinRight', speed: 60, duration: turn }, { command: 'forward', speed: 60, duration: 20 }),
    );
    nearWall(x, 0);
    expect(y).toBeCloseTo(121, 0);
  });

  it('turned left, heads east', () => {
    const turn = spinSecondsForDegrees(90, 60);
    const [x] = endInYard(
      drive({ command: 'spinLeft', speed: 60, duration: turn }, { command: 'forward', speed: 60, duration: 20 }),
    );
    nearWall(x, YARD.widthCm);
  });

  it('converts between the rover and the yard both ways', () => {
    for (const [x, y] of [[0, 0], [12.5, -40], [-80, 33]]) {
      const [back, forth] = yardToRover(...roverToYard(x, y));
      expect(back).toBeCloseTo(x, 9);
      expect(forth).toBeCloseTo(y, 9);
    }
  });
});

describe('the yard on screen', () => {
  // 1 px per cm once the renderer's 10 px margin is taken off each side.
  const L = computeLayout(YARD.widthCm + 20, YARD.depthCm + 20);

  it('puts the start where it is in the yard, with north at the top', () => {
    const [x, y] = worldToScreen(L, 0, 0);
    expect(x).toBeCloseTo(10 + 116.5, 6);
    expect(y).toBeCloseTo(10 + 121, 6);
  });

  it('draws forward as down the screen, because the rover starts facing south', () => {
    const [x0, y0] = worldToScreen(L, 0, 0);
    const [x1, y1] = worldToScreen(L, 0, 10);
    expect(x1).toBeCloseTo(x0, 6);
    expect(y1).toBeCloseTo(y0 + 10, 6);
  });

  it("draws the rover's right as screen left, west, for the same reason", () => {
    const [x0] = worldToScreen(L, 0, 0);
    const [x1] = worldToScreen(L, 10, 0);
    expect(x1).toBeCloseTo(x0 - 10, 6);
  });
});
