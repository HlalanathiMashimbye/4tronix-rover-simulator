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
import { computeLayout, crashMark, worldToScreen } from '@/lib/roverSimRender';
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

  it('marks the spot once the playhead reaches it, and keeps it after', () => {
    const run = towardsR4();
    const frame = findCrash(run)!.frame;
    expect(crashMark(L, run, frame - 1)).toBeNull();
    const spot = worldToScreen(L, run[frame].x, run[frame].y);
    expect(crashMark(L, run, frame)).toEqual(spot);
    expect(crashMark(L, run, run.length - 1)).toEqual(spot);
  });

  it('marks nothing for a run that hits nothing', () => {
    const run = straightSouth();
    expect(crashMark(L, run, run.length - 1)).toBeNull();
  });
});
