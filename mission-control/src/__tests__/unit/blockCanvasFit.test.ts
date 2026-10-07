/**
 * @jest-environment node
 */

/**
 * How a block canvas frames its program, and the phone's bin (6 Oct 2026).
 *
 * On an iPhone the blocks opened large, a long program ran off the canvas,
 * and Blockly's trashcan, drawn at one fixed size, was a fifth of the
 * canvas's width. A program now opens fitted with room round it, never
 * blown up or shrunk past reading, and the bin is our own smaller one.
 *
 * Node, not jsdom: the bin is checked against Blockly's real DeleteArea, and
 * Blockly's own entry point only loads outside jsdom.
 */

import * as BlocklyModule from 'blockly';

import { createBin, fitBlocks, FIT_FILL, READABLE_SCALE, type BinState } from '@/components/mission/blockCanvasControls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Blockly = BlocklyModule as any;

/** A workspace holding a program of this size, in a canvas of that size. */
function canvas(program: { width: number; height: number }, view: { width: number; height: number }) {
  const seen: { scale: number | null; centred: boolean; scrolledTo: unknown } = { scale: null, centred: false, scrolledTo: null };
  const start = { getBoundingRectangleWithoutChildren: () => 'the first block' };
  const workspace = {
    getBlocksBoundingBox: () => ({ left: 40, top: 40, right: 40 + program.width, bottom: 40 + program.height }),
    getMetricsManager: () => ({ getViewMetrics: () => view }),
    setScale: (scale: number) => {
      seen.scale = scale;
    },
    scrollCenter: () => {
      seen.centred = true;
    },
    getTopBlocks: () => [start],
    scrollBoundsIntoView: (bounds: unknown) => {
      seen.scrolledTo = bounds;
    },
  };
  return { workspace, seen };
}

describe('opening a program', () => {
  it('fits all of it, centred, with room round it', () => {
    const { workspace, seen } = canvas({ width: 200, height: 400 }, { width: 300, height: 300 });
    fitBlocks(workspace, 1);
    // The tightest side, the height, is filled to FIT_FILL and no further.
    expect(400 * seen.scale!).toBeCloseTo(300 * FIT_FILL);
    expect(400 * seen.scale!).toBeLessThan(300);
    expect(seen.centred).toBe(true);
    expect(seen.scrolledTo).toBeNull();
  });

  it('never blows a short program up past the size it is built at', () => {
    const { workspace, seen } = canvas({ width: 100, height: 100 }, { width: 400, height: 400 });
    fitBlocks(workspace, 0.75);
    expect(seen.scale).toBe(0.75);
  });

  it('keeps a long program readable and opens it at its start', () => {
    const { workspace, seen } = canvas({ width: 200, height: 2000 }, { width: 300, height: 300 });
    fitBlocks(workspace, 0.75);
    expect(seen.scale).toBe(READABLE_SCALE);
    expect(seen.scrolledTo).toBe('the first block');
  });

  it('only centres an empty canvas', () => {
    const { workspace, seen } = canvas({ width: 0, height: 0 }, { width: 300, height: 300 });
    fitBlocks(workspace, 1);
    expect(seen.scale).toBeNull();
    expect(seen.centred).toBe(true);
  });
});

describe('the bin', () => {
  // Drawn 32px square, at the canvas's top right.
  const element = { getBoundingClientRect: () => ({ top: 10, bottom: 42, left: 300, right: 332 }) } as unknown as HTMLElement;
  const make = () => {
    const states: BinState[] = [];
    return { bin: createBin(Blockly, element, (state) => states.push(state)), states };
  };

  it('is a delete area Blockly knows', () => {
    expect(make().bin).toBeInstanceOf(Blockly.DeleteArea);
  });

  it('takes a block let go of on it, or just past its drawn edge', () => {
    const area = make().bin.getClientRect();
    expect(area.contains(316, 26)).toBe(true);
    expect(area.contains(292, 26)).toBe(true);
    expect(area.contains(316, 50)).toBe(true);
    expect(area.contains(260, 26)).toBe(false);
    expect(area.contains(316, 90)).toBe(false);
  });

  it('deletes what can be deleted, and nothing else', () => {
    const { bin } = make();
    // Shaped as Blockly's IDeletable, which is what it checks for.
    const dragged = (deletable: boolean) => ({ isDeletable: () => deletable, dispose: () => {}, setDeleteStyle: () => {} });
    expect(bin.wouldDelete(dragged(true))).toBe(true);
    expect(bin.wouldDelete(dragged(false))).toBe(false);
  });

  it('says when a block is over it, has left it, and has been dropped', () => {
    const { bin, states } = make();
    bin.onDragEnter();
    bin.onDragExit();
    bin.onDragEnter();
    bin.onDrop();
    expect(states).toEqual(['over', 'dragging', 'over', 'idle']);
  });
});
