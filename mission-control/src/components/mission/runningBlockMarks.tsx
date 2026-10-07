'use client';

import { useEffect, useState, type RefObject } from 'react';
import { Play } from 'lucide-react';
import type { CommandSource } from '@/lib/roverBlockly';

/**
 * What a block canvas shows while the simulator runs its program (AB#450):
 * the spotlight, the running block's glow, a "now" tag that glides from block
 * to block, and a "2 / 3" pass badge on each running Repeat.
 *
 * One implementation for every canvas that shows a running program: the
 * editor learners build in and the read-only viewer on a mission's page. They
 * were about to grow two copies, and a highlight that behaves differently in
 * the two places a child sees their program is the kind of drift this
 * codebase keeps paying for. globals.css owns how it looks.
 */

/** Roughly how wide the "now" tag renders, to keep it inside the canvas. */
const NOW_TAG_WIDTH = 60;

/** Where the run markers sit over the canvas, in px from its top-left. */
interface LoopMark {
  key: string;
  left: number;
  top: number;
  /** "2 / 3": which pass of the Repeat is running. */
  label: string;
}
export interface RunMarks {
  step: { left: number; top: number } | null;
  loops: LoopMark[];
}

export function useRunningBlockMarks({
  workspaceRef,
  hostRef,
  highlight,
  ready,
}: {
  // The Blockly workspace (an untyped global, as everywhere else here).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspaceRef: RefObject<any>;
  /** The element Blockly was injected into. */
  hostRef: RefObject<HTMLDivElement | null>;
  highlight: CommandSource | null;
  /** True once the workspace exists and holds its blocks. */
  ready: boolean;
}): RunMarks | null {
  // Light up the running block, and any Repeat it is inside. Our own classes
  // rather than Blockly's highlightBlock, because the two jobs look different:
  // the step pops and glows, the Repeat around it gets a moving dashed edge so
  // it reads as "going round". globals.css owns both, and drops the motion
  // under prefers-reduced-motion. Ids are checked first because a block can
  // be deleted without changing the generated Python, so the highlight
  // survives the edit that removed its block.
  //
  // Keyed as JSON, not joined with commas: Blockly's generated ids draw from
  // a character set that includes the comma, so a split came apart mid-id and
  // only the Repeat, whose id happened to have none, ever lit up. The passes
  // are in the key too, so a one-block loop pops again on every pass.
  const highlightKey = JSON.stringify([highlight?.blockIds ?? [], highlight?.passes ?? []]);
  const [marks, setMarks] = useState<RunMarks | null>(null);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const host = hostRef.current;
    if (!ready || !workspace || !host) return;
    const [ids, passes] = JSON.parse(highlightKey) as [string[], { pass: number; of: number }[]];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lit: { block: any; className: string }[] = [];
    ids.forEach((id, i) => {
      const block = workspace.getBlockById(id);
      if (!block) return;
      const className = i === ids.length - 1 ? 'rover-running-step' : 'rover-running-loop';
      // Restart the pop when the same block runs again on the next pass:
      // removing and re-adding a class in one tick does not replay a CSS
      // animation, a forced reflow in between does.
      block.removeClass(className);
      void block.getSvgRoot()?.getBoundingClientRect();
      block.addClass(className);
      lit.push({ block, className });
    });

    // FOLLOW IT. A program zoomed in, or longer than the canvas, ran its
    // later steps off screen, and on a phone the canvas is half the screen.
    // Only the block's own shape, not the stack under it, and Blockly leaves
    // the canvas alone when that is already in view or a finger is on it.
    const step = lit.find((l) => l.className === 'rover-running-step')?.block;
    if (step?.getBoundingRectangleWithoutChildren) {
      workspace.scrollBoundsIntoView?.(step.getBoundingRectangleWithoutChildren(), 24);
    }

    // THE SPOTLIGHT. Everything not running dims, so the running block is
    // the one bright thing on the canvas. A green outline on its own was easy
    // to miss on a busy program ("the green thingy is boring").
    host.classList.toggle('roverSpotlight', lit.length > 0);

    // The tag beside the running block and the pass count on each loop are
    // HTML over the canvas, so they are measured from the blocks and
    // re-measured whenever the canvas scrolls, zooms or changes.
    const measure = () => {
      const frame = host.getBoundingClientRect();
      // Only the block's own shape: its svg group also contains every block
      // stacked after it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rectOf = (block: any) => block.getSvgRoot()?.querySelector(':scope > .blocklyPath')?.getBoundingClientRect();
      const stepBlock = lit.find((l) => l.className === 'rover-running-step')?.block;
      const stepRect = stepBlock && rectOf(stepBlock);
      setMarks({
        // Beside the block when there is room, otherwise pulled back inside
        // the canvas: a wide block in a narrow panel (the operator console)
        // pushed the tag off the right edge, half of it cut away.
        step: stepRect
          ? {
              left: Math.min(stepRect.right - frame.left + 6, frame.width - NOW_TAG_WIDTH - 4),
              top: stepRect.top - frame.top + Math.min(stepRect.height, 40) / 2,
            }
          : null,
        loops: lit
          .filter((l) => l.className === 'rover-running-loop')
          .map((l, i) => {
            const rect = rectOf(l.block);
            const pass = passes[i];
            return rect && pass
              ? { key: l.block.id, left: rect.right - frame.left - 4, top: rect.top - frame.top - 8, label: `${pass.pass} / ${pass.of}` }
              : null;
          })
          .filter((m): m is LoopMark => m !== null),
      });
    };

    let raf: number | null = null;
    const remeasure = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        measure();
      });
    };
    if (lit.length > 0) {
      measure();
      workspace.addChangeListener(remeasure);
    } else {
      setMarks(null);
    }

    return () => {
      lit.forEach(({ block, className }) => block.removeClass(className));
      host.classList.remove('roverSpotlight');
      workspace.removeChangeListener(remeasure);
      if (raf !== null) cancelAnimationFrame(raf);
    };
    }, [highlightKey, ready, workspaceRef, hostRef]);


  return marks;
}

/**
 * The tag and badges, over the canvas. Render it inside the same positioned
 * element as the Blockly host, so its coordinates line up.
 */
export function RunningBlockOverlay({ marks }: { marks: RunMarks | null }) {
  return (
    <>
      {marks?.step && (
        // Glides from block to block (transition in globals.css), so a
        // learner can follow the program with their eye, not just spot it.
        <div className="roverNowTag" style={{ left: marks.step.left, top: marks.step.top }} aria-hidden="true">
          <Play className="h-2.5 w-2.5" fill="currentColor" />
          now
        </div>
      )}
      {marks?.loops.map((loop) => (
        <div key={loop.key} className="roverPassBadge" style={{ left: loop.left, top: loop.top }}>
          <span className="sr-only">Repeat pass </span>
          {loop.label}
        </div>
      ))}
    </>
  );
}
