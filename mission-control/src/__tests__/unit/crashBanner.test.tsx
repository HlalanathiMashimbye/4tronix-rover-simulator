/**
 * @jest-environment jsdom
 */

/**
 * The crash banner says what happened and keeps saying it (AB#466).
 *
 * It used to show only on the frames where the rover was still pushing into
 * what it hit, so a run that crashed and then backed away lost the banner a
 * moment later, while the pre-flight check went on refusing to send it. A
 * crash is a fact about the run from the crash frame on.
 */

import { act, render, screen } from '@testing-library/react';

import { RoverSimulator } from '@/components/mission/RoverSimulator';
import type { TrajectoryPoint } from '@/lib/simulateCommands';

jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('@/hooks/useYardFloor', () => ({ useYardFloor: () => null }));

beforeAll(() => {
  const gradient = { addColorStop: () => undefined };
  HTMLCanvasElement.prototype.getContext = jest.fn(
    () => new Proxy({}, { get: () => () => gradient }),
  ) as unknown as HTMLCanvasElement['getContext'];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 466 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 498 });
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** Drives at R4, hits it on frame 10 and pushes for five frames, then backs away. */
function crashThenBackAway(): TrajectoryPoint[] {
  return Array.from({ length: 30 }, (_, i) => ({
    x: 0,
    y: i < 10 ? i : i < 15 ? 10 : 25 - i,
    heading: 0,
    speedL: 60,
    speedR: 60,
    servos: { '9': 0, '15': 0, '11': 0, '13': 0 },
    hitWall: false,
    hitRock: i >= 10 && i < 15 ? 'R4' : null,
    leds: [null, null, null, null],
  }));
}

const scrub = (frame: number) =>
  act(() => {
    const slider = screen.getByLabelText('Scrub simulation frame') as HTMLInputElement;
    // React tracks the input's value; set it the way a user's drag would.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(frame));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });

it('shows no crash before the rover reaches the rock', () => {
  render(<RoverSimulator trajectory={crashThenBackAway()} isPlaying={false} editorMode="code" />);
  scrub(5);
  expect(screen.queryByRole('status')).toBeNull();
});

it('says it hit a rock from the crash frame, and still says so after it backs away', () => {
  render(<RoverSimulator trajectory={crashThenBackAway()} isPlaying={false} editorMode="code" />);
  scrub(10);
  expect(screen.getByRole('status')).toHaveTextContent(/rock/i);
  scrub(29);
  expect(screen.getByRole('status')).toHaveTextContent(/rock/i);
});
