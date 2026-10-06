/**
 * @jest-environment jsdom
 */

/**
 * A phone's block canvas (6 Oct 2026): Show all the blocks where Blockly's
 * zoom buttons would be, a bin that is registered with Blockly for as long as
 * the canvas exists, and a run that the canvas and the code follow down the
 * program as it plays.
 *
 * What the bin deletes is Blockly's DeleteArea, checked against the real one
 * in blockCanvasFit.test.ts. Here a stand-in Blockly is enough: what is under
 * test is the wiring, not Blockly.
 */

import { useRef } from 'react';
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react';

import { BlockCanvasControls, useBlockBin } from '@/components/mission/blockCanvasControls';
import { useRunningBlockMarks } from '@/components/mission/runningBlockMarks';
import { CodeLines } from '@/components/mission/CodeLines';

describe('the corner controls', () => {
  it('shows all the blocks on request', () => {
    const onShowAll = jest.fn();
    render(<BlockCanvasControls onShowAll={onShowAll} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all the blocks' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('has no bin on a canvas that cannot be edited', () => {
    render(<BlockCanvasControls onShowAll={() => {}} />);
    expect(screen.queryByRole('img', { name: /bin/i })).not.toBeInTheDocument();
  });

  it('has a bin on one that can', () => {
    const { result } = renderHook(() => useRef<HTMLDivElement>(null));
    render(<BlockCanvasControls onShowAll={() => {}} binRef={result.current} bin="over" />);
    expect(screen.getByRole('img', { name: /bin/i })).toHaveAttribute('data-bin', 'over');
  });
});

describe('registering the bin', () => {
  const BLOCK_DRAG = 'block_drag';
  let added: { component: { id: string }; capabilities: string[] }[];
  let removed: string[];
  let listeners: ((event: unknown) => void)[];

  beforeEach(() => {
    added = [];
    removed = [];
    listeners = [];
    window.Blockly = {
      DeleteArea: class {},
      utils: { Rect: class {} },
      ComponentManager: { Capability: { DELETE_AREA: 'delete_area', DRAG_TARGET: 'drag_target' } },
      Events: { BLOCK_DRAG },
    };
  });
  afterEach(() => {
    delete (window as { Blockly?: unknown }).Blockly;
  });

  const workspace = () => ({
    getComponentManager: () => ({
      addComponent: (entry: { component: { id: string }; capabilities: string[] }) => added.push(entry),
      removeComponent: (id: string) => removed.push(id),
    }),
    addChangeListener: (listener: (event: unknown) => void) => listeners.push(listener),
    removeChangeListener: (listener: (event: unknown) => void) => {
      listeners = listeners.filter((l) => l !== listener);
    },
  });

  function mount(ready = true) {
    const workspaceRef = { current: workspace() };
    const binRef = { current: document.createElement('div') };
    return renderHook(({ ready }) => useBlockBin({ workspaceRef, binRef, ready }), { initialProps: { ready } });
  }

  it('as a place blocks are dropped and deleted, once the canvas is ready', () => {
    const { rerender } = mount(false);
    expect(added).toHaveLength(0);
    rerender({ ready: true });
    expect(added).toHaveLength(1);
    expect(added[0].capabilities).toEqual(expect.arrayContaining(['delete_area', 'drag_target']));
  });

  it('and takes it away with the canvas', () => {
    const { unmount } = mount();
    const { id } = added[0].component;
    unmount();
    expect(removed).toEqual([id]);
    expect(listeners).toHaveLength(0);
  });

  it('says a block is on its way while one is dragged', () => {
    const { result } = mount();
    act(() => listeners.forEach((l) => l({ type: BLOCK_DRAG, isStart: true })));
    expect(result.current).toBe('dragging');
    act(() => listeners.forEach((l) => l({ type: BLOCK_DRAG, isStart: false })));
    expect(result.current).toBe('idle');
  });

  it('ignores everything else that happens on the canvas', () => {
    const { result } = mount();
    act(() => listeners.forEach((l) => l({ type: 'click', isStart: true })));
    expect(result.current).toBe('idle');
  });
});

describe('following a run', () => {
  it('scrolls the canvas to the running block, by its own shape and not the stack under it', () => {
    const scrollBoundsIntoView = jest.fn();
    const path = document.createElement('div');
    path.className = 'blocklyPath';
    const root = document.createElement('div');
    root.appendChild(path);
    const block = {
      id: 'b1',
      addClass: () => {},
      removeClass: () => {},
      getSvgRoot: () => root,
      getBoundingRectangleWithoutChildren: () => 'just this block',
      getBoundingRectangle: () => 'this block and everything under it',
    };
    const workspaceRef = {
      current: { getBlockById: () => block, addChangeListener: () => {}, removeChangeListener: () => {}, scrollBoundsIntoView },
    };
    const hostRef = { current: document.createElement('div') };
    const highlight = { blockIds: ['b1'] };
    renderHook(() => useRunningBlockMarks({ workspaceRef, hostRef, highlight, ready: true }));
    expect(scrollBoundsIntoView).toHaveBeenCalledWith('just this block', expect.any(Number));
  });

  describe('in the code', () => {
    // jsdom lays nothing out, so each line is given a place: 20px tall,
    // stacked from the top, in a box 100px tall.
    const descriptors = ['offsetTop', 'offsetHeight', 'clientHeight'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const,
    );
    beforeAll(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
        configurable: true,
        get(this: HTMLElement) {
          return this.tagName === 'SPAN' ? [...this.parentElement!.children].indexOf(this) * 20 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.tagName === 'SPAN' ? 20 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.tagName === 'PRE' ? 100 : 0;
        },
      });
    });
    afterAll(() => {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
      }
    });

    const code = Array.from({ length: 30 }, (_, i) => `rover.forward(${i})`).join('\n');
    const box = () => document.querySelector('pre')!;

    it('scrolls a line below the box up into it', () => {
      render(<CodeLines code={code} highlight={{ fromLine: 20 }} />);
      // Line 20 runs from 380 to 400; the box shows 100px.
      expect(box().scrollTop).toBeGreaterThan(300);
      expect(box().scrollTop).toBeLessThanOrEqual(380);
    });

    it('scrolls back up to a line above the box', () => {
      const { rerender } = render(<CodeLines code={code} highlight={{ fromLine: 20 }} />);
      rerender(<CodeLines code={code} highlight={{ fromLine: 2 }} />);
      expect(box().scrollTop).toBeLessThanOrEqual(20);
    });

    it('leaves the box alone for a line already in it', () => {
      render(<CodeLines code={code} highlight={{ fromLine: 3 }} />);
      expect(box().scrollTop).toBe(0);
    });
  });
});
