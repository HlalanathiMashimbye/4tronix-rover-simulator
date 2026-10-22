/**
 * @jest-environment jsdom
 */

/**
 * Rocks are targets (8 October 2026).
 *
 * David and Werner: a rock is where a mission goes, not only what it has to
 * miss. Until then the only way to get to a rock was to touch it, and touching
 * it is a crash. So each rock has a ring 20% wider than it (REACH_SCALE): inside
 * the ring the rover has reached the rock, and the rock itself is still a
 * crash. These check the ring is where it says, that a run reaches a rock
 * before it can hit it, that the map and the banner say so, and that a crash
 * still outranks it.
 */

import { act, render, screen } from '@testing-library/react';

import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { REACH_SCALE, YARD, rockReached, rockTouching, type Yard } from '@/lib/rover-physics';
import { computeLayout, drawSimFrame, TARGET_COLOURS } from '@/lib/roverSimRender';
import { crashFrame, simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';

jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('@/hooks/useYardFloor', () => ({ useYardFloor: () => null }));

// Every fill style painted, on the frame or on the cached ground behind it.
let fills: string[] = [];
const recorder = () =>
  new Proxy(
    {},
    {
      get: () => () => ({ addColorStop: () => undefined }),
      set: (_, key, value) => {
        if (key === 'fillStyle' && typeof value === 'string') fills.push(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(recorder) as unknown as HTMLCanvasElement['getContext'];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 466 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 498 });
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('the reached ring', () => {
  // One round rock 20 cm across, dead ahead of the start: its edge is 10 cm
  // from its centre and its ring 12. The rover's nose is 10 cm ahead of its
  // centre, so driven f cm forward the nose is 65 - f cm from the rock's centre.
  const yard: Yard = { ...YARD, rocks: [{ name: 'T', x: YARD.start.x + 75, y: YARD.start.y, widthCm: 20, depthCm: 20 }] };
  const at = (forward: number) => [rockReached(0, forward, 0, yard)?.name ?? null, rockTouching(0, forward, 0, yard)?.name ?? null];

  it('is 20% wider than the rock', () => {
    expect(REACH_SCALE).toBe(1.2);
    expect(at(52)).toEqual([null, null]);
    // 11 cm from the centre: inside the ring, clear of the rock.
    expect(at(54)).toEqual(['T', null]);
    expect(at(56)).toEqual(['T', 'T']);
  });
});

describe('a run at R4', () => {
  // Straight on from the start meets R4 (realYard.test.ts).
  const run = () => simulateCommands([{ command: 'forward', speed: 60, duration: 14 }]);

  it('reaches R4 before it can hit it', () => {
    const traj = run();
    const reachedAt = traj.findIndex((point) => point.reached === 'R4');
    expect(reachedAt).toBeGreaterThan(0);
    expect(reachedAt).toBeLessThan(crashFrame(traj));
  });

  it('reaches nothing when it stops short of the ring', () => {
    expect(simulateCommands([{ command: 'forward', speed: 60, duration: 5 }]).some((p) => p.reached)).toBe(false);
  });

  const painted = (traj: TrajectoryPoint[], playhead: number) => {
    fills = [];
    drawSimFrame(recorder(), computeLayout(466, 498), traj, playhead);
    return fills;
  };

  it('rings every rock green on the map', () => {
    expect(painted([], 0)).toContain(TARGET_COLOURS.fill);
  });

  it('fills the ring in from the frame the rover gets there, and keeps it filled', () => {
    const traj = run();
    const reachedAt = traj.findIndex((point) => point.reached);
    expect(painted(traj, reachedAt - 1)).not.toContain(TARGET_COLOURS.reachedFill);
    expect(painted(traj, reachedAt)).toContain(TARGET_COLOURS.reachedFill);
    expect(painted(traj, traj.length - 1)).toContain(TARGET_COLOURS.reachedFill);
  });
});

describe('the banner', () => {
  /** Drives into R4's ring on frame 10, stays to 15, hits the rock on 15, backs out of the ring on 20. */
  function reachThenCrash(): TrajectoryPoint[] {
    return Array.from({ length: 30 }, (_, i) => ({
      x: 0,
      y: i,
      heading: 0,
      speedL: 60,
      speedR: 60,
      servos: { '9': 0, '15': 0, '11': 0, '13': 0 },
      hitWall: false,
      hitRock: i === 15 ? 'R4' : null,
      reached: i >= 10 && i < 20 ? 'R4' : null,
      leds: [null, null, null, null],
    }));
  }
  /** The same run without the crash. */
  const reachOnly = () => reachThenCrash().map((point) => ({ ...point, hitRock: null }));

  const scrub = (frame: number) =>
    act(() => {
      const slider = screen.getByLabelText('Scrub simulation frame') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(frame));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('says the rover reached the rock while it is there, and not before or after', () => {
    render(<RoverSimulator trajectory={reachOnly()} isPlaying={false} editorMode="code" />);
    scrub(5);
    expect(screen.queryByRole('status')).toBeNull();
    scrub(12);
    expect(screen.getByRole('status')).toHaveTextContent('Your rover reached R4.');
    scrub(25);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives way to a crash', () => {
    render(<RoverSimulator trajectory={reachThenCrash()} isPlaying={false} editorMode="code" />);
    scrub(12);
    expect(screen.getByRole('status')).toHaveTextContent(/reached R4/);
    scrub(16);
    expect(screen.getByRole('status')).toHaveTextContent(/would hit a rock/);
  });
});
