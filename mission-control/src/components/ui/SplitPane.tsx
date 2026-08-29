'use client';

/**
 * Two panels with a draggable divider between them.
 *
 * Extracted from MissionWorkspace so the mission view can have the same
 * control as Create Mission. It was ~70 lines of pointer-capture and
 * delta-mapping logic that had already been tuned twice against real
 * measurements; copying it to a second page would have meant two copies to
 * keep in step. See .workspaceSplitGrid in globals.css for why the grid is
 * deliberately untransitioned.
 *
 * Below the lg breakpoint the grid collapses to one column and the divider is
 * display:none, so this degrades to a plain stack on tablets and phones.
 */

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Percentage of the splittable width given to the left panel. */
  defaultSplit?: number;
  minSplit?: number;
  maxSplit?: number;
  /** Describes what is being resized, for screen readers. */
  ariaLabel: string;
  /**
   * Height of the grid. Defaults to the Create Mission viewport calculation;
   * pass '100%' when the split already sits inside a sized flex parent.
   */
  height?: string;
  /**
   * Whether the divider can be moved. Default true.
   *
   * The mission VIEW sets this false and takes a fixed 70/30. Letting a
   * learner resize their own video was ambition rather than a need: a video
   * player wants one shape and looks better holding it, and a draggable
   * divider beside it invites fiddling with a layout that was already right.
   * Create Mission keeps the drag, where trading space between an editor and
   * a preview is a real working need.
   */
  resizable?: boolean;
}

export function SplitPane({
  left,
  right,
  defaultSplit = 60,
  minSplit = 35,
  maxSplit = 75,
  ariaLabel,
  height,
  resizable = true,
}: SplitPaneProps) {
  const [panelSplit, setPanelSplit] = useState(defaultSplit);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  // Drives the divider's active styling only. The grid itself is deliberately
  // untransitioned (see .workspaceSplitGrid in globals.css), so there is no
  // easing to suppress while a drag is in flight.
  const [isSplitDragging, setIsSplitDragging] = useState(false);
  // Read synchronously inside pointermove, which must not depend on a React
  // re-render having landed first.
  const draggingRef = useRef(false);

  // Apply CSS variables to the container via DOM to avoid JSX inline styles.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty('--workspace-left', `${panelSplit}fr`);
    el.style.setProperty('--workspace-right', `${100 - panelSplit}fr`);
  }, [panelSplit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !height) return;
    el.style.setProperty('--workspace-height', height);
  }, [height]);

  // Where the pointer went down, and what the split was at that moment.
  // The drag is applied as a delta from these rather than as an absolute
  // cursor-to-percentage mapping: the fr tracks share out the container
  // MINUS the divider and the two gaps, so an absolute mapping lands the
  // handle tens of pixels away from the cursor and it visibly jumps out from
  // under the grab on the first move.
  const dragStartRef = useRef<{ x: number; split: number } | null>(null);

  // The width the fr tracks actually divide between them. Dividing the drag
  // delta by this (rather than the full container width) is what makes the
  // handle keep pace with the cursor exactly instead of drifting ~2% behind
  // over a long throw.
  const splittableWidth = () => {
    const el = containerRef.current;
    if (!el) return 0;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const dividerW = dividerRef.current?.getBoundingClientRect().width ?? 0;
    return el.getBoundingClientRect().width - dividerW - gap * 2;
  };

  const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Pointer capture keeps the drag alive when the cursor outruns the
    // 11px divider, which it does constantly on a fast throw.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { x: event.clientX, split: panelSplit };
    draggingRef.current = true;
    setIsSplitDragging(true);
  };

  const handleDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!draggingRef.current || !start) return;
    const width = splittableWidth();
    if (width <= 0) return;
    // Deliberately not rounded to whole percent: at ~1230px of splittable
    // width, 1% is over 12px, so rounding would make the panel edge climb in
    // visible 12px stairs instead of following the cursor.
    const deltaPct = ((event.clientX - start.x) / width) * 100;
    setPanelSplit(Math.min(maxSplit, Math.max(minSplit, start.split + deltaPct)));
  };

  const endDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingRef.current = false;
    dragStartRef.current = null;
    // Settle on a whole percent so the announced value agrees with what was
    // just dragged to.
    setPanelSplit((current) => Math.round(current));
    setIsSplitDragging(false);
  };

  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    setPanelSplit((current) => Math.min(maxSplit, Math.max(minSplit, current + delta)));
  };

  return (
    <div
      // Two tracks when there is no divider. The lg grid declares three -
      // left, an auto track for the divider, then right - so with the divider
      // gone the right panel landed in the AUTO track: sized to its content,
      // sitting in the middle of the screen, with the third track empty beside
      // it. A class rather than an inline style, because below lg the grid must
      // still collapse to one column and an inline rule would outrank that.
      className={`workspaceSplitGrid${resizable ? '' : ' workspaceSplitGrid--fixed'}`}
      ref={containerRef}
    >
      {left}

      {/* No divider when the split is fixed. Rendering an inert one would
          still read as a handle and invite a drag that does nothing. */}
      {resizable && (
      /* Grab-anywhere divider: the mouse control for the split. Sits under
         the cursor and moves with it exactly. */
      <div
        ref={dividerRef}
        className="workspaceSplitDivider"
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(panelSplit)}
        aria-valuemin={minSplit}
        aria-valuemax={maxSplit}
        tabIndex={0}
        data-dragging={isSplitDragging ? 'true' : 'false'}
        onPointerDown={handleDividerPointerDown}
        onPointerMove={handleDividerPointerMove}
        onPointerUp={endDividerDrag}
        onPointerCancel={endDividerDrag}
        onKeyDown={handleDividerKeyDown}
        onDoubleClick={() => setPanelSplit(defaultSplit)}
        title="Drag to resize · double-click to reset"
      />
      )}

      {right}
    </div>
  );
}
