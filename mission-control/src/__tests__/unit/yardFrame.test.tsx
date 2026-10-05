/**
 * @jest-environment jsdom
 */

/**
 * The simulator is framed in the yard's own shape, and nothing else in its
 * column can change its size (AB#464).
 *
 * jsdom does no layout, so these hold the STRUCTURE that makes the size
 * constant: the frame's proportions come from YARD, the play controls are
 * inside the frame (laid over the yard) rather than beside it in the column,
 * and the footer slot is the same slot whichever bar fills it. The sizes
 * themselves were measured in a browser: one size in Drive, Blocks and Python,
 * before and after a run.
 */

import { render, screen, fireEvent } from '@testing-library/react';

import { YardFrame } from '@/components/mission/YardFrame';
import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { DriveFooter } from '@/components/mission/DriveFooter';
import { PreFlightChecklist } from '@/components/mission/PreFlightChecklist';
import { YARD } from '@/lib/rover-physics';
import type { TrajectoryPoint } from '@/lib/simulateCommands';

jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('@/hooks/useYardFloor', () => ({ useYardFloor: () => null }));

beforeAll(() => {
  const gradient = { addColorStop: () => undefined };
  HTMLCanvasElement.prototype.getContext = jest.fn(
    () => new Proxy({}, { get: () => () => gradient }),
  ) as unknown as HTMLCanvasElement['getContext'];
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const RUN: TrajectoryPoint[] = Array.from({ length: 10 }, (_, i) => ({
  x: 0,
  y: i,
  heading: 0,
  speedL: 60,
  speedR: 60,
  servos: { '9': 0, '15': 0, '11': 0, '13': 0 },
  hitWall: false,
  leds: [null, null, null, null],
}));

it("takes the frame's proportions from the measured yard", () => {
  const { container } = render(<YardFrame>inside</YardFrame>);
  const space = container.querySelector('[data-yard-frame-space]') as HTMLElement;
  expect(Number(space.style.getPropertyValue('--yard-ratio'))).toBeCloseTo(YARD.widthCm / YARD.depthCm, 9);
  expect(container.querySelector('[data-yard-frame]')).toHaveTextContent('inside');
});

it('lays the play controls over the yard, where they cannot take its height', () => {
  const { container } = render(<RoverSimulator trajectory={RUN} isPlaying editorMode="code" />);
  const frame = container.querySelector('[data-yard-frame]') as HTMLElement;
  expect(frame).toContainElement(screen.getByLabelText('Scrub simulation frame'));
  expect(frame).toContainElement(screen.getByLabelText('Reset'));
});

it('gives every footer the same fixed slot, outside the yard', () => {
  const slotFor = (footer: React.ReactNode) => {
    const { container, unmount } = render(
      <RoverSimulator trajectory={RUN} isPlaying editorMode="code" footer={footer} />,
    );
    const slot = container.querySelector('[data-sim-footer]') as HTMLElement;
    const inFrame = container.querySelector('[data-yard-frame]')!.contains(slot);
    const className = slot.className;
    unmount();
    return { className, inFrame };
  };

  const drive = slotFor(<DriveFooter onResetPosition={() => {}} />);
  const short = slotFor(<p>one line</p>);
  expect(drive.inFrame).toBe(false);
  // Its size is the simFooter rule's (globals.css), the same for every footer.
  expect(drive.className).toContain('simFooter');
  expect(short.className).toBe(drive.className);
});

it("puts the rover back from Drive's footer", () => {
  const reset = jest.fn();
  render(<DriveFooter onResetPosition={reset} />);
  fireEvent.click(screen.getByRole('button', { name: /reset position/i }));
  expect(reset).toHaveBeenCalledTimes(1);
});

it('invites rather than explains a failure before there is any code', () => {
  const unstarted = {
    ready: false,
    duration: 0,
    checks: [
      { id: 'simulation-run' as const, passed: false },
      { id: 'rover-moves' as const, passed: false },
      { id: 'runs-long-enough' as const, passed: false },
      { id: 'within-time-limit' as const, passed: true },
    ],
  };
  const { rerender } = render(<PreFlightChecklist result={unstarted} started={false} />);
  expect(screen.queryByText(/press run to try/i)).toBeNull();
  rerender(<PreFlightChecklist result={unstarted} started />);
  expect(screen.getByText(/press run to try/i)).toBeInTheDocument();
  // Each check still says what it is, in full, to a screen reader.
  expect(screen.getByRole('listitem', { name: /you have watched it in the simulator: not yet/i })).toBeInTheDocument();
});
