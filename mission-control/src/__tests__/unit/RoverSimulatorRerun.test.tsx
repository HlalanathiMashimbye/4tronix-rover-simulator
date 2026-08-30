/**
 * @jest-environment jsdom
 */

/**
 * Running the same program twice must play it twice (AB#409).
 *
 * THE BUG THIS LOCKS OUT. The playback effect was keyed on
 * `trajectory.length`. Pressing Run again on an unchanged program produced a
 * new trajectory of the SAME length, with isPlaying already true and isPaused
 * already false, so nothing in its dependency list changed and no frame loop
 * was scheduled. Meanwhile the sibling effect rewound the playhead to 0. The
 * rover sat at the start, the button read "Pause", and only Reset - which
 * empties the trajectory and therefore does change the length - recovered it.
 *
 * It looked intermittent because editing the code usually changes the frame
 * count, which hid it. Re-running the same program exposed it every time.
 */

import { render, screen, act } from '@testing-library/react';

import { RoverSimulator } from '@/components/mission/RoverSimulator';
import type { TrajectoryPoint } from '@/lib/simulateCommands';

jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

// The canvas is irrelevant here; only the playhead is under test. A proxy
// swallows whatever drawScene reaches for without pinning the test to the
// drawing code.
//
// Every method hands back a gradient-shaped stub. The renderer builds its
// ground and vignette with createRadialGradient/createLinearGradient and then
// calls addColorStop on the result, so a proxy returning undefined throws the
// moment the paint path runs. It did not run here until the simulator started
// sizing itself from the canvas's own client box - the clientWidth and
// clientHeight defined just below had never actually reached it, because the
// old code measured the wrapper's getBoundingClientRect, which jsdom reports
// as zero, and drawScene bailed out on a zero-width layout.
beforeAll(() => {
  const gradient = { addColorStop: () => undefined };
  HTMLCanvasElement.prototype.getContext = jest.fn(
    () => new Proxy({}, { get: () => () => gradient }),
  ) as unknown as HTMLCanvasElement['getContext'];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** A distinct array each call, deliberately always the same length. */
function trajectoryOf(frames: number): TrajectoryPoint[] {
  return Array.from({ length: frames }, (_, i) => ({
    x: i * 5,
    y: 0,
    heading: 0,
    speedL: 50,
    speedR: 50,
    servos: { '9': 0, '15': 0, '11': 0, '13': 0 },
    hitWall: false,
    leds: [null, null, null, null],
  })) as TrajectoryPoint[];
}

function playhead(): number {
  return Number((screen.getByLabelText('Scrub simulation frame') as HTMLInputElement).value);
}

/** Drive the rAF loop far enough that the playhead must have moved. */
async function runFrames(count: number) {
  for (let i = 0; i < count; i++) {
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
  }
}

describe('re-running the same program', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('plays again without needing Reset first', async () => {
    const first = trajectoryOf(36);
    const { rerender } = render(
      <RoverSimulator trajectory={first} isPlaying editorMode="code" />,
    );

    await runFrames(10);
    const afterFirstRun = playhead();
    expect(afterFirstRun).toBeGreaterThan(0);

    // Let it finish, exactly as a learner would before pressing Run again.
    await runFrames(120);
    expect(playhead()).toBe(35);

    // Run pressed a second time on the SAME program: a new array, same length.
    // This is the case that used to freeze.
    const second = trajectoryOf(36);
    expect(second).not.toBe(first);
    expect(second.length).toBe(first.length);

    rerender(<RoverSimulator trajectory={second} isPlaying editorMode="code" />);

    // Rewound to the start, which always worked.
    expect(playhead()).toBe(0);

    // And actually playing again, which did not.
    await runFrames(10);
    expect(playhead()).toBeGreaterThan(0);
  });
});
