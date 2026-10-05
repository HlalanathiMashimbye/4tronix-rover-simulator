/**
 * Crashes are caught before sending (AB#466).
 *
 * The yard is the measured one, rocks and all, so a run that hits a rock or a
 * wall in the simulator is headed for a real one. These drive into R4, the
 * big rock south-east of the start, and past it, and check that the physics
 * stops the rover, that the one crash rule finds it, that the pre-flight check
 * blocks Send on it, and that the simulator marks the spot.
 */

import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import { YARD, rockTouching, spinSecondsForDegrees } from '@/lib/rover-physics';
import { computeLayout, crashImpact, crashMotion } from '@/lib/roverSimRender';
import { findCrash } from '@/core/domain/safety/crashCheck';
import { runPreFlightChecks } from '@/core/domain/safety/preFlightChecks';
import type { SimulationCommand } from '@/lib/roverBlockly';

const drive = (...commands: SimulationCommand[]): TrajectoryPoint[] => simulateCommands(commands);

// R4 is 24.5 cm east and 12 cm south of the start; the rover faces south, so
// it is ahead and to the left. Turned left about 64 degrees, it is dead ahead.
const towardsR4 = () =>
  drive(
    { command: 'spinLeft', speed: 60, duration: spinSecondsForDegrees(64, 60) },
    { command: 'forward', speed: 60, duration: 4 },
  );
const straightSouth = () => drive({ command: 'forward', speed: 60, duration: 5 });

const VALID = 'rover.forward(60)\ntime.sleep(3)\nrover.stop()\n';

describe('rocks in the physics', () => {
  it('lets the rover drive straight past R4, which it clears by a few centimetres', () => {
    expect(straightSouth().some((point) => point.hitRock)).toBe(false);
  });

  it('stops the rover at R4 and keeps it there while it is driven at it', () => {
    const run = towardsR4();
    const first = run.findIndex((point) => point.hitRock);
    expect(first).toBeGreaterThan(0);
    expect(run[first].hitRock).toBe('R4');
    const stopped = run.slice(first);
    for (const point of stopped) {
      expect(point.x).toBeCloseTo(run[first].x, 9);
      expect(point.y).toBeCloseTo(run[first].y, 9);
    }
    // And never inside it.
    for (const point of run) expect(rockTouching(point.x, point.y, point.heading)).toBeNull();
  });
});

describe('the one crash rule', () => {
  it('finds no crash in a run that hits nothing', () => {
    expect(findCrash(straightSouth())).toBeNull();
  });

  it('names the rock, the frame and the time of a rock crash', () => {
    const run = towardsR4();
    const crash = findCrash(run)!;
    expect(crash).toMatchObject({ into: 'rock', rock: 'R4' });
    expect(run[crash.frame].hitRock).toBe('R4');
    expect(crash.atSeconds).toBeCloseTo(crash.frame / 10, 9);
  });

  it('calls running into the edge of the yard a wall crash', () => {
    const crash = findCrash(drive({ command: 'forward', speed: 60, duration: 20 }))!;
    expect(crash.into).toBe('wall');
    expect(crash.rock).toBeUndefined();
  });
});

describe('the no-crash pre-flight check', () => {
  const noCrash = (context: Parameters<typeof runPreFlightChecks>[1]) =>
    runPreFlightChecks(VALID, context).checks.find((check) => check.id === 'no-crash')!;

  it('passes a watched run that hit nothing, and lets it be sent', () => {
    expect(noCrash({ hasRunSimulation: true, crash: null }).passed).toBe(true);
    expect(runPreFlightChecks(VALID, { hasRunSimulation: true, crash: null }).ready).toBe(true);
  });

  it('blocks Send on a watched run that crashed', () => {
    const crash = findCrash(towardsR4());
    expect(noCrash({ hasRunSimulation: true, crash }).passed).toBe(false);
    expect(runPreFlightChecks(VALID, { hasRunSimulation: true, crash }).ready).toBe(false);
  });

  it('cannot pass before a run has been watched', () => {
    expect(noCrash({ hasRunSimulation: false, crash: null }).passed).toBe(false);
  });
});

describe('the crash on screen', () => {
  const L = computeLayout(YARD.widthCm, YARD.depthCm);
  const R4 = YARD.rocks.find((rock) => rock.name === 'R4')!;

  it('puts the impact on the rock, on the side the rover hit it from', () => {
    const run = towardsR4();
    const impact = crashImpact(L, run)!;
    expect(impact.rock?.name).toBe('R4');
    expect(impact.frame).toBe(findCrash(run)!.frame);
    // On the rock's edge...
    const [x, y] = impact.contact;
    expect(Math.hypot(x - R4.x, y - R4.y)).toBeCloseTo(Math.max(R4.widthCm, R4.depthCm) / 2, 6);
    // ...facing the start, where the rover came from (north-west of R4).
    expect(x).toBeLessThan(R4.x);
    expect(y).toBeLessThan(R4.y);
    expect(Math.hypot(...impact.away)).toBeCloseTo(1, 9);
  });

  it('puts a wall crash on the wall it ran into', () => {
    const impact = crashImpact(L, drive({ command: 'forward', speed: 60, duration: 20 }))!;
    expect(impact.wall).toBe('south');
    expect(impact.contact[1]).toBe(YARD.depthCm);
    // Bounces back north, into the yard.
    expect(impact.away).toEqual([0, -1]);
  });

  it('has nothing to show for a run that hits nothing', () => {
    expect(crashImpact(L, straightSouth())).toBeNull();
  });

  it('shakes, bounces and throws grit at the moment, and leaves only the scar after', () => {
    const now = crashMotion(0.05);
    expect(Math.hypot(...now.shake)).toBeGreaterThan(0);
    expect(now.recoilCm).toBeGreaterThan(0);
    expect(now.flash).toBeGreaterThan(0);
    expect(now.debris).toBeGreaterThan(0);
    const later = crashMotion(1.5);
    expect(later).toEqual({ shake: [0, 0], recoilCm: 0, joltCm: 0, flash: 0, ring: 0, debris: 0, tint: 0 });
  });

  it('moves nothing for a viewer who asked for less motion', () => {
    const now = crashMotion(0.05, true);
    expect(now.shake).toEqual([0, 0]);
    expect(now.recoilCm).toBe(0);
    expect(now.joltCm).toBe(0);
    expect(now.debris).toBe(0);
    expect(now.ring).toBe(0);
    expect(now.tint).toBe(0);
  });
});
