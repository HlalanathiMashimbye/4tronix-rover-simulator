/**
 * Crashes are caught before sending (AB#466).
 *
 * The yard is the measured one, rocks and all, so a run that hits a rock or a
 * wall in the simulator is headed for a real one. These drive into R4, the
 * big rock straight ahead of the start, and past it, and check that the physics
 * stops the rover, that the one crash rule finds it, that the pre-flight check
 * blocks Send on it, and that the simulator marks the spot and nothing more.
 */

import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import { YARD, rockTouching, spinSecondsForDegrees } from '@/lib/rover-physics';
import { computeLayout, crashImpact, drawSimFrame } from '@/lib/roverSimRender';
import { findCrash } from '@/core/domain/safety/crashCheck';
import { runPreFlightChecks } from '@/core/domain/safety/preFlightChecks';
import type { SimulationCommand } from '@/lib/roverBlockly';

const drive = (...commands: SimulationCommand[]): TrajectoryPoint[] => simulateCommands(commands);

// R4 is 116 cm east and 12 cm south of the start, and the rover faces east,
// so driving straight on clips its northern edge. Turned 5 degrees left it
// just scrapes past; at 4 it still hits.
const towardsR4 = () => drive({ command: 'forward', speed: 60, duration: 14 });
const pastR4 = (degrees = 5) =>
  drive(
    { command: 'spinLeft', speed: 60, duration: spinSecondsForDegrees(degrees, 60) },
    { command: 'forward', speed: 60, duration: 16 },
  );
// Turned right it faces the front wall, with nothing in the way.
const intoTheFrontWall = () =>
  drive(
    { command: 'spinRight', speed: 60, duration: spinSecondsForDegrees(90, 60) },
    { command: 'forward', speed: 60, duration: 20 },
  );

const VALID = 'rover.forward(60)\ntime.sleep(3)\nrover.stop()\n';

describe('rocks in the physics', () => {
  it('lets the rover drive past R4 when it is turned just enough to clear it', () => {
    expect(pastR4().some((point) => point.hitRock)).toBe(false);
    // A degree less and it clips the rock: the clearance is that fine.
    expect(pastR4(4).some((point) => point.hitRock === 'R4')).toBe(true);
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
    expect(findCrash(pastR4())).toBeNull();
  });

  it('names the rock, the frame and the time of a rock crash', () => {
    const run = towardsR4();
    const crash = findCrash(run)!;
    expect(crash).toMatchObject({ into: 'rock', rock: 'R4' });
    expect(run[crash.frame].hitRock).toBe('R4');
    expect(crash.atSeconds).toBeCloseTo(crash.frame / 10, 9);
  });

  it('calls running into the edge of the yard a wall crash', () => {
    const crash = findCrash(intoTheFrontWall())!;
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
    // ...facing the start, where the rover came from (west and a little north of R4).
    expect(x).toBeLessThan(R4.x);
    expect(y).toBeLessThan(R4.y);
    expect(Math.hypot(...impact.away)).toBeCloseTo(1, 9);
  });

  it('puts a wall crash on the wall it ran into', () => {
    const impact = crashImpact(L, intoTheFrontWall())!;
    expect(impact.wall).toBe('south');
    expect(impact.contact[1]).toBe(YARD.depthCm);
    // Bounces back north, into the yard.
    expect(impact.away).toEqual([0, -1]);
  });

  it('has nothing to show for a run that hits nothing', () => {
    expect(crashImpact(L, pastR4())).toBeNull();
  });

  /** Every call and assignment a frame makes on the canvas, in order. */
  const drawing = (traj: TrajectoryPoint[], playhead: number): string[] => {
    const log: string[] = [];
    const gradient = { addColorStop: (...args: unknown[]) => log.push(`addColorStop ${args.join()}`) };
    const ctx = new Proxy(
      {},
      {
        get: (_, key) => (...args: unknown[]) => {
          log.push(`${String(key)} ${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join()}`);
          return gradient;
        },
        set: (_, key, value) => {
          log.push(`${String(key)}=${value}`);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    drawSimFrame(ctx, L, traj, playhead);
    return log;
  };

  it('marks what it hit and changes nothing else: nothing shakes, bounces or flies', () => {
    // The real rover stops against the rock and the rock stays put. So a
    // crashed run must draw exactly what the same path would without the
    // crash, the rover included, plus the red ring and nothing more.
    const run = towardsR4();
    const unmarked = run.map((point) => ({ ...point, hitRock: null, hitWall: false }));
    const frame = findCrash(run)!.frame;
    for (const playhead of [frame, frame + 0.4, frame + 3, run.length - 1]) {
      const crashed = drawing(run, playhead);
      const ring = crashed.indexOf('strokeStyle=rgba(239,68,68,0.95)');
      expect(ring).toBeGreaterThan(0);
      const start = crashed.lastIndexOf('save ', ring);
      const end = crashed.indexOf('restore ', ring);
      expect(crashed.slice(start, end + 1).filter((op) => op.startsWith('ellipse'))).toHaveLength(1);
      expect([...crashed.slice(0, start), ...crashed.slice(end + 1)]).toEqual(drawing(unmarked, playhead));
    }
  });

  it('marks nothing before the crash', () => {
    const run = towardsR4();
    expect(drawing(run, findCrash(run)!.frame - 1)).not.toContain('strokeStyle=rgba(239,68,68,0.95)');
  });
});
