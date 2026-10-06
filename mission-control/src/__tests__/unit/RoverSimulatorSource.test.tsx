/**
 * @jest-environment jsdom
 */

/**
 * The simulator tells the editor what is running (AB#450).
 *
 * The editors only draw what they are told, so this is where the story's
 * timing lives: the highlight follows the playhead, holds on a pause, and
 * clears when the run ends or is reset. A highlight left on the last block
 * after the rover has stopped reads as "still running".
 */

import { render, act, fireEvent, screen } from '@testing-library/react';

import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { simulateCommands } from '@/lib/simulateCommands';
import type { CommandSource } from '@/lib/roverBlockly';

jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

// Same canvas stubs as RoverSimulatorRerun.test.tsx; see there for why.
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

const FIRST: CommandSource = { fromLine: 1, toLine: 2 };
const SECOND: CommandSource = { fromLine: 4, toLine: 5 };

// One second forward then one second back: about ten frames each.
const trajectory = simulateCommands([
  { command: 'forward', speed: 60, duration: 1, source: FIRST },
  { command: 'reverse', speed: 60, duration: 1, source: SECOND },
]);

async function runFrames(count: number) {
  for (let i = 0; i < count; i++) {
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
  }
}

describe('reporting what is running', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('carries each command source on its frames, and none on the start', () => {
    expect(trajectory[0].source).toBeUndefined();
    expect(trajectory[5].source).toBe(FIRST);
    expect(trajectory[trajectory.length - 1].source).toBe(SECOND);
  });

  it('follows the playhead and clears when the run finishes', async () => {
    const seen: (CommandSource | null)[] = [];
    render(<RoverSimulator trajectory={trajectory} isPlaying editorMode="code" onSourceChange={(s) => seen.push(s)} />);

    await runFrames(200);

    expect(seen).toEqual([FIRST, SECOND, null]);
  });

  it('holds on a pause, and clears on reset', async () => {
    const onSourceChange = jest.fn();
    render(<RoverSimulator trajectory={trajectory} isPlaying editorMode="code" onSourceChange={onSourceChange} />);

    await runFrames(4);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await runFrames(50);
    expect(onSourceChange).toHaveBeenLastCalledWith(FIRST);

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onSourceChange).toHaveBeenLastCalledWith(null);
  });

  it('clears when it leaves the screen, so no block stays lit for a hidden run', async () => {
    const onSourceChange = jest.fn();
    const { unmount } = render(<RoverSimulator trajectory={trajectory} isPlaying editorMode="code" onSourceChange={onSourceChange} />);
    await runFrames(4);
    expect(onSourceChange).toHaveBeenLastCalledWith(FIRST);
    unmount();
    expect(onSourceChange).toHaveBeenLastCalledWith(null);
  });

  it('reports nothing for manual driving, which has no program', async () => {
    const onSourceChange = jest.fn();
    render(<RoverSimulator trajectory={trajectory} isPlaying editorMode="manual" onSourceChange={onSourceChange} />);
    await runFrames(5);
    expect(onSourceChange).not.toHaveBeenCalledWith(FIRST);
    expect(onSourceChange).not.toHaveBeenCalledWith(SECOND);
  });
});

/**
 * "Watched" means played to the end, not "Run was pressed" (AB#455). On a
 * phone Run turns into Send at that moment, so firing early would let a
 * double tap launch a mission nobody had seen.
 */
describe('reporting a run watched to the end', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('only once the last frame has played', async () => {
    const onFinished = jest.fn();
    render(<RoverSimulator trajectory={trajectory} isPlaying editorMode="code" onFinished={onFinished} />);

    await runFrames(4);
    expect(onFinished).not.toHaveBeenCalled();

    await runFrames(200);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('when the learner drags to the end instead', () => {
    const onFinished = jest.fn();
    render(<RoverSimulator trajectory={trajectory} isPlaying={false} editorMode="code" onFinished={onFinished} />);
    const scrubber = screen.getByLabelText('Scrub simulation frame');

    fireEvent.change(scrubber, { target: { value: '3' } });
    expect(onFinished).not.toHaveBeenCalled();

    fireEvent.change(scrubber, { target: { value: String(trajectory.length - 1) } });
    expect(onFinished).toHaveBeenCalled();
  });
});
