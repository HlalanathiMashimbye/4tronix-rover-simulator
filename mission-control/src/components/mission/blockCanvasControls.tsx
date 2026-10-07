'use client';

import { useEffect, useState, type RefObject } from 'react';
import { LocateFixed, Trash2 } from 'lucide-react';

/**
 * How a block canvas frames its program, and the two controls it has on a
 * phone: show all the blocks, and a bin.
 *
 * Shared by the editor and the read-only viewer, so a program opens framed
 * the same way wherever a child sees it.
 */

/**
 * How much of the canvas a fitted program fills. The rest is margin, so the
 * blocks sit in the canvas with room round them rather than pressed against
 * its edges, which is what a plain zoomToFit does.
 */
export const FIT_FILL = 0.75;

/**
 * The smallest a program is shrunk to fit. Fitted all the way down, a
 * twelve-block program on half a phone was drawn at 0.35, words three pixels
 * high (6 Oct 2026). Past this it stays readable and scrolls instead.
 */
export const READABLE_SCALE = 0.5;

/**
 * Every block in view, centred, with a margin round them.
 *
 * Never bigger than `maxScale`: fitted exactly, a two-block program filled a
 * phone's canvas with blocks the size of buttons. Never smaller than
 * READABLE_SCALE: a program too long to fit at that size opens at its start,
 * the On uplink block at the top, and the rest is a scroll away (and a run
 * follows the running block down: runningBlockMarks).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fitBlocks(workspace: any, maxScale: number): void {
  const blocks = workspace.getBlocksBoundingBox();
  // In pixels, and without the category strip or the flyout.
  const view = workspace.getMetricsManager().getViewMetrics();
  const width = blocks.right - blocks.left;
  const height = blocks.bottom - blocks.top;
  let tooLong = false;
  if (width > 0 && height > 0 && view.width > 0 && view.height > 0) {
    const fit = Math.min(view.width / width, view.height / height) * FIT_FILL;
    const scale = Math.min(maxScale, Math.max(fit, READABLE_SCALE));
    tooLong = fit < scale;
    workspace.setScale(scale);
  }
  workspace.scrollCenter();
  if (tooLong) {
    // Sorted top to bottom, so the first is where the program starts.
    const start = workspace.getTopBlocks(true)[0];
    if (start) workspace.scrollBoundsIntoView(start.getBoundingRectangleWithoutChildren(), 24);
  }
}

/** Whether a block is being dragged, and whether it is over the bin. */
export type BinState = 'idle' | 'dragging' | 'over';

/**
 * How far past its drawn edge the bin still takes a block. The drawn bin is
 * small so it does not cover the program; the place a finger lets go of a
 * block is not that precise.
 */
const BIN_REACH = 12;

/**
 * The bin as something Blockly deletes into: a DeleteArea whose shape is our
 * own element's.
 *
 * Blockly's trashcan is drawn at one fixed size, 47 by 60 px whatever the
 * zoom, and on a phone that was a fifth of the canvas's width beside blocks
 * already shrunk to fit (6 Oct 2026). Its sizes are constants inside Blockly,
 * so the way to a smaller bin is our own, registered through the component
 * manager the trashcan itself uses. Deleting is still Blockly's: a block
 * dropped while over any delete area is disposed by the dragger.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBin(Blockly: any, element: HTMLElement, onState: (state: BinState) => void) {
  class Bin extends Blockly.DeleteArea {
    id = 'roverBin';
    getClientRect() {
      const r = element.getBoundingClientRect();
      return new Blockly.utils.Rect(r.top - BIN_REACH, r.bottom + BIN_REACH, r.left - BIN_REACH, r.right + BIN_REACH);
    }
    onDragEnter() {
      onState('over');
    }
    onDragExit() {
      onState('dragging');
    }
    onDrop() {
      onState('idle');
    }
  }
  return new Bin();
}

/**
 * Registers the bin on the workspace for as long as both exist, and says
 * when a block is on its way to it, so the bin can show it is the target.
 */
export function useBlockBin({
  workspaceRef,
  binRef,
  ready,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspaceRef: RefObject<any>;
  binRef: RefObject<HTMLElement | null>;
  ready: boolean;
}): BinState {
  const [state, setState] = useState<BinState>('idle');

  useEffect(() => {
    const workspace = workspaceRef.current;
    const element = binRef.current;
    const Blockly = typeof window === 'undefined' ? undefined : window.Blockly;
    if (!ready || !workspace || !element || !Blockly) return;

    const bin = createBin(Blockly, element, setState);
    const manager = workspace.getComponentManager();
    const { Capability } = Blockly.ComponentManager;
    manager.addComponent({ component: bin, weight: 1, capabilities: [Capability.DELETE_AREA, Capability.DRAG_TARGET] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDrag = (event: any) => {
      if (event?.type !== Blockly.Events.BLOCK_DRAG) return;
      setState(event.isStart ? 'dragging' : 'idle');
    };
    workspace.addChangeListener(onDrag);

    return () => {
      workspace.removeChangeListener(onDrag);
      manager.removeComponent(bin.id);
      setState('idle');
    };
  }, [workspaceRef, binRef, ready]);

  return state;
}

/**
 * The corner controls, over the canvas's top right: Show all the blocks, and
 * the bin when the canvas can be edited.
 *
 * Top right because a phone's flyout opens upward from the category strip
 * along the bottom, and anything in the bottom corners sat on top of it.
 * Small, the size of the simulator's own corner buttons, because they share
 * the canvas with the program.
 */
export function BlockCanvasControls({
  onShowAll,
  binRef,
  bin = 'idle',
}: {
  onShowAll: () => void;
  /** The bin's element, for useBlockBin. Absent on a read-only canvas. */
  binRef?: RefObject<HTMLDivElement | null>;
  bin?: BinState;
}) {
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onShowAll}
        aria-label="Show all the blocks"
        title="Show all the blocks"
        className="clay-press pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
      >
        <LocateFixed className="h-4 w-4" />
      </button>
      {binRef && (
        // Not a button: nothing happens on a tap. It is where blocks are
        // dropped, and says so when one is on its way and when one is over it.
        <div
          ref={binRef}
          role="img"
          aria-label="Bin: drag a block here to delete it"
          data-bin={bin}
          className="roverBin flex h-8 w-8 items-center justify-center rounded-full border"
        >
          <Trash2 className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
