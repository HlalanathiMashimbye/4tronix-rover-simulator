/**
 * @jest-environment jsdom
 */

/**
 * Rising ground in the yard (AB#468): rings of yellow, orange and red round
 * the two mound peaks.
 *
 * A zone is a warning and never a block. These drive the rover from the start
 * up onto the north peak, 74 cm away, and check that each ring is recorded as
 * it is crossed, that the physics drives on exactly as it would on the flat,
 * that the learner is warned and can still send, that the operator's preview
 * calls it something to look at rather than a stop, and that the simulator
 * draws the rings.
 */

import { render, screen } from '@testing-library/react';

import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import { YARD, spinSecondsForDegrees, zoneAt, type Yard } from '@/lib/rover-physics';
import { computeLayout, drawSimFrame, ZONE_COLOURS } from '@/lib/roverSimRender';
import { findSlope } from '@/core/domain/safety/slopeCheck';
import { runPreFlightChecks } from '@/core/domain/safety/preFlightChecks';
import { previewMission } from '@/core/domain/safety/missionPreview';
import { PreFlightChecklist } from '@/components/mission/PreFlightChecklist';
import type { SimulationCommand } from '@/lib/roverBlockly';

const NORTH_PEAK = { x: 94, y: 94 };

// From the start, facing east, the north peak is 21 degrees round to the left
// and 74 cm on; 8 seconds stops just short of the top, inside the red ring.
const toTheNorthPeak: SimulationCommand[] = [
  { command: 'spinLeft', speed: 60, duration: spinSecondsForDegrees(21, 60) },
  { command: 'forward', speed: 60, duration: 8 },
];
const CODE = 'rover.spinLeft(60)\ntime.sleep(0.5)\nrover.stop()\nrover.forward(60)\ntime.sleep(8)\nrover.stop()\n';
const climb = () => simulateCommands(toTheNorthPeak);
const flat = () => simulateCommands([{ command: 'forward', speed: 60, duration: 2 }]);

describe('the zones in the yard', () => {
  it('gives the steepest ring at a point, and nothing on the flat', () => {
    expect(zoneAt(NORTH_PEAK.x, NORTH_PEAK.y)).toBe('red');
    expect(zoneAt(NORTH_PEAK.x + 12, NORTH_PEAK.y)).toBe('orange');
    expect(zoneAt(NORTH_PEAK.x + 22, NORTH_PEAK.y)).toBe('yellow');
    // Yellow is the whole mound, not a ring round each peak...
    expect(zoneAt(NORTH_PEAK.x + 30, NORTH_PEAK.y)).toBe('yellow');
    // ...and the floor beyond its edge, the start included, is flat.
    expect(zoneAt(NORTH_PEAK.x + 60, NORTH_PEAK.y)).toBeNull();
    expect(zoneAt(YARD.start.x, YARD.start.y)).toBeNull();
  });

  it('reads an ellipse as wide as rx and as deep as ry', () => {
    const yard: Yard = { ...YARD, zones: [{ level: 'yellow', x: 100, y: 100, rx: 40, ry: 10 }] };
    expect(zoneAt(135, 100, yard)).toBe('yellow');
    expect(zoneAt(100, 115, yard)).toBeNull();
  });
});

describe('a run up the north peak', () => {
  it('records each ring as it climbs, gentlest first', () => {
    const levels = climb()
      .map((point) => point.zone)
      .filter((zone, i, all) => zone && zone !== all[i - 1]);
    expect(levels).toEqual(['yellow', 'orange', 'red']);
  });

  it('drives exactly as it would on flat ground: a zone is a warning, not physics', () => {
    const open = simulateCommands(toTheNorthPeak, { ...YARD, zones: [] });
    const run = climb();
    expect(run.map(({ x, y, heading }) => [x, y, heading])).toEqual(open.map(({ x, y, heading }) => [x, y, heading]));
  });

  it('finds the steepest ground and the moment it first gets there', () => {
    const run = climb();
    const slope = findSlope(run)!;
    expect(slope.level).toBe('red');
    expect(run[slope.frame].zone).toBe('red');
    expect(run.slice(0, slope.frame).every((point) => point.zone !== 'red')).toBe(true);
    expect(findSlope(flat())).toBeNull();
  });
});

describe('telling the learner', () => {
  const checks = (trajectory: TrajectoryPoint[]) =>
    runPreFlightChecks(CODE, { hasRunSimulation: true, crash: null, slope: findSlope(trajectory) });

  it('warns about the slope and still lets the mission be sent', () => {
    const result = checks(climb());
    expect(result.checks.find((check) => check.id === 'flat-ground')!.passed).toBe(false);
    expect(result.ready).toBe(true);
  });

  it('passes the flat-ground check for a run that stays on the flat', () => {
    expect(checks(flat()).checks.find((check) => check.id === 'flat-ground')!.passed).toBe(true);
  });

  it('says what the slope may do, and that it can still be sent', () => {
    render(<PreFlightChecklist result={checks(climb())} />);
    expect(screen.getByRole('listitem', { name: /slopes.*can still send it/i })).toBeInTheDocument();
    expect(screen.getByText(/can still send it/i)).toBeInTheDocument();
  });

  it('gives the operator something to look at, never a stop', () => {
    const slope = previewMission(CODE, climb()).find((finding) => finding.id === 'slope')!;
    expect(slope.level).toBe('warn');
    expect(previewMission(CODE, flat()).find((finding) => finding.id === 'slope')!.level).toBe('ok');
  });
});

describe('drawing the zones', () => {
  // Every fill style painted, on the frame or on the cached ground behind it.
  // The ground is painted once to an offscreen canvas and reused, so this
  // records from every context, the offscreen one included.
  let used: string[] = [];
  const recorder = () =>
    new Proxy(
      {},
      {
        get: () => () => ({ addColorStop: () => undefined }),
        set: (_, key, value) => {
          if (key === 'fillStyle' && typeof value === 'string') used.push(value);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = jest.fn(recorder) as unknown as HTMLCanvasElement['getContext'];
  });

  const fills = (yard: Yard): string[] => {
    used = [];
    drawSimFrame(recorder(), computeLayout(466, 498, yard), [], 0);
    return used;
  };

  it('tints every ring in its colour', () => {
    const painted = fills(YARD);
    for (const level of ['yellow', 'orange', 'red'] as const) expect(painted).toContain(ZONE_COLOURS[level].fill);
  });

  it('draws none for a yard with only its rocks', () => {
    const painted = fills({ ...YARD, zones: [] });
    for (const level of ['yellow', 'orange', 'red'] as const) expect(painted).not.toContain(ZONE_COLOURS[level].fill);
  });

  it('repaints the cached ground when the layout changes and the canvas does not', () => {
    // An admin editing zones with the yard drawn beside the form: same size,
    // same palette, a new layout. The ground has to follow it.
    fills({ ...YARD, zones: [] });
    const painted = fills(YARD);
    expect(painted).toContain(ZONE_COLOURS.red.fill);
  });
});
