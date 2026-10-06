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
import { computeFillLayout, computeLayout, drawnBearing, startMark, worldToScreen, type SimLayout } from '@/lib/roverSimRender';
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

  it('turned left, heads east, and meets R4 long before the east wall', () => {
    // R4 is 12 cm south of the seam; the rover is 9.25 cm wide each side of
    // its centre and R4 is 11.5 cm round, so a drive along the seam clips it.
    const turn = spinSecondsForDegrees(90, 60);
    const run = drive({ command: 'spinLeft', speed: 60, duration: turn }, { command: 'forward', speed: 60, duration: 20 });
    expect(run[run.length - 1].hitRock).toBe('R4');
    const [x] = endInYard(run);
    expect(x).toBeGreaterThan(YARD.start.x);
    expect(x).toBeLessThan(YARD.rocks.find((rock) => rock.name === 'R4')!.x);
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
  // A canvas the yard's own shape, at 1 px per cm.
  const L = computeLayout(YARD.widthCm, YARD.depthCm);

  it('stretches the yard to fill a canvas of any shape, corner to corner', () => {
    // A phone's strip: far wider than the yard is.
    const strip = computeLayout(351, 244);
    const [nwX, nwY] = worldToScreen(strip, ...yardToRover(0, 0));
    const [seX, seY] = worldToScreen(strip, ...yardToRover(YARD.widthCm, YARD.depthCm));
    expect([nwX, nwY].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0]);
    expect(seX).toBeCloseTo(351, 6);
    expect(seY).toBeCloseTo(244, 6);
  });

  it('draws the rover pointing the way its trail runs on a stretched yard', () => {
    // Stretched across: a rover heading south-west (clear of every rock)
    // moves more across than down on screen, and must be drawn turned that
    // way, not at its compass bearing of 225 degrees.
    const wide = computeLayout(YARD.widthCm * 2, YARD.depthCm);
    const run = drive(
      { command: 'spinRight', speed: 60, duration: spinSecondsForDegrees(45, 60) },
      { command: 'forward', speed: 60, duration: 3 },
    );
    const [a, b] = [run[run.length - 20], run[run.length - 1]];
    const [ax, ay] = worldToScreen(wide, a.x, a.y);
    const [bx, by] = worldToScreen(wide, b.x, b.y);
    const trailAngle = (Math.atan2(bx - ax, -(by - ay)) * 180) / Math.PI;
    expect(drawnBearing(wide, b.heading)).toBeCloseTo(trailAngle, 3);
    expect(run.some((point) => point.hitRock || point.hitWall)).toBe(false);
    expect(Math.abs(drawnBearing(wide, b.heading) - -135)).toBeGreaterThan(10);
  });

  it('puts the start where it is in the yard, with north at the top', () => {
    const [x, y] = worldToScreen(L, 0, 0);
    expect(x).toBeCloseTo(116.5, 6);
    expect(y).toBeCloseTo(121, 6);
  });

  it('draws forward as down the screen, because the rover starts facing south', () => {
    const [x0, y0] = worldToScreen(L, 0, 0);
    const [x1, y1] = worldToScreen(L, 0, 10);
    expect(x1).toBeCloseTo(x0, 6);
    expect(y1).toBeCloseTo(y0 + 10, 6);
  });

  it('draws the start mark as a cross on the start spot, reaching past the rover on every side', () => {
    const { centre, tips } = startMark(L);
    expect(centre).toEqual(worldToScreen(L, 0, 0));
    // Four arms, each pointing no way more than another, and each longer than
    // the rover's body reaches that way (10 cm ahead and behind, 9.25 aside),
    // so the tips show around a parked rover.
    const lengths = tips.map(([x, y]) => Math.hypot(x - centre[0], y - centre[1]));
    expect(new Set(lengths.map((l) => l.toFixed(6))).size).toBe(1);
    expect(lengths[0]).toBeGreaterThan(10 * L.s);
    const [ahead, behind, right, left] = tips;
    expect(ahead[0] + behind[0]).toBeCloseTo(2 * centre[0], 6);
    expect(right[1] + left[1]).toBeCloseTo(2 * centre[1], 6);
  });

  it("draws the rover's right as screen left, west, for the same reason", () => {
    const [x0] = worldToScreen(L, 0, 0);
    const [x1] = worldToScreen(L, 10, 0);
    expect(x1).toBeCloseTo(x0 - 10, 6);
  });
});

describe('the yard filling a wide panel', () => {
  // About the size the home feed draws a cover: a wide strip. The mission page
  // and the phone strip are wide too, if less so.
  const W = 320;
  const H = 140;

  function onCard(L: SimLayout, x: number, y: number) {
    const [sx, sy] = worldToScreen(L, x, y);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx).toBeLessThanOrEqual(W);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sy).toBeLessThanOrEqual(H);
  }

  it('is filled edge to edge by the yard, with no bars beside it', () => {
    const L = computeFillLayout(W, H, drive({ command: 'forward', speed: 60, duration: 5 }));
    expect(L.ox).toBeLessThanOrEqual(0);
    expect(L.oy).toBeLessThanOrEqual(0);
    expect(L.ox + YARD.widthCm * L.s).toBeGreaterThanOrEqual(W - 1e-6);
    expect(L.oy + YARD.depthCm * L.s).toBeGreaterThanOrEqual(H - 1e-6);
  });

  it('shows the whole of a short trail', () => {
    const run = drive({ command: 'forward', speed: 60, duration: 5 });
    const L = computeFillLayout(W, H, run);
    for (const point of run) onCard(L, point.x, point.y);
  });

  it('shows where the rover finished when the trail is longer than the card', () => {
    const run = drive({ command: 'forward', speed: 60, duration: 30 });
    const end = run[run.length - 1];
    onCard(computeFillLayout(W, H, run), end.x, end.y);
  });

  it('follows a trail to the back of the yard', () => {
    const run = drive({ command: 'reverse', speed: 60, duration: 8 });
    const L = computeFillLayout(W, H, run);
    for (const point of run) onCard(L, point.x, point.y);
  });

  it('holds still while a run that fits plays', () => {
    const run = drive({ command: 'forward', speed: 60, duration: 5 });
    const first = computeFillLayout(W, H, run, run[0]);
    for (const point of run) {
      const L = computeFillLayout(W, H, run, point);
      expect(L.ox).toBeCloseTo(first.ox, 9);
      expect(L.oy).toBeCloseTo(first.oy, 9);
    }
  });

  it('follows the rover through a run too long to frame, never losing it', () => {
    const run = drive({ command: 'forward', speed: 60, duration: 30 });
    for (const point of run) onCard(computeFillLayout(W, H, run, point), point.x, point.y);
  });
});
