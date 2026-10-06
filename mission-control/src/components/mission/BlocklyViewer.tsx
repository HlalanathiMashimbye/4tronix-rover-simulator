'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { loadBlockly } from '@/infrastructure/browser/loadBlockly';
import { defineRoverBlocks, migrateSpinBlocks, type CommandSource } from '@/lib/roverBlockly';
import { RunningBlockOverlay, useRunningBlockMarks } from '@/components/mission/runningBlockMarks';
import { useIsPhoneLayout } from '@/hooks/useIsPhoneLayout';

/**
 * Read-only Blockly rendering of a saved workspace (mission.blocklyState).
 *
 * Shares infrastructure/browser/loadBlockly with the editor - one script, one cache - and renders
 * the program without a toolbox, so learners can see the blocks they will
 * remix. Pan/zoom stay on (scrollbars + wheel) but editing is off.
 *
 * `highlight` lights up the block the simulator is running, exactly as the
 * editor does (runningBlockMarks.tsx), so watching a mission's simulation
 * shows which block drives which move. On a phone the zoom buttons go and two
 * fingers zoom instead, as in the editor: they sat on top of the program.
 */
export function BlocklyViewer({
  state,
  highlight = null,
  fit = false,
  maxFitScale = 1,
  zoomControls = !fit,
}: {
  state: string;
  highlight?: CommandSource | null;
  /**
   * Scale the whole program into view instead of centring it at the set
   * zoom. For the operator console, where the panel is short and the job is
   * to check the program end to end: centred, a tall program showed its
   * middle, with the On uplink block and the first steps cut off.
   */
  fit?: boolean;
  /**
   * The most a fitted program is scaled up. 1 is the editor's size, which is
   * right for the operator's quick check; a learner's own mission page has
   * room to show a short program bigger, where at the editor's size it sat
   * small in a big white canvas.
   */
  maxFitScale?: number;
  /** The zoom buttons, off by default when fitted (see zoom below). */
  zoomControls?: boolean;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspaceRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const phone = useIsPhoneLayout();
  const marks = useRunningBlockMarks({ workspaceRef, hostRef: divRef, highlight, ready });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadBlockly()
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch((err) => {
        console.error('[BlocklyViewer] Blockly failed to load:', err);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  useEffect(() => {
    if (!loaded || !divRef.current || !window.Blockly) return;

    const Blockly = window.Blockly;
    defineRoverBlocks(Blockly);

    const workspace = Blockly.inject(divRef.current, {
      readOnly: true,
      renderer: 'zelos',
      move: { drag: true, scrollbars: true, wheel: true },
      // No zoom buttons on a phone (two fingers instead) or when fitted (the
      // program is already sized to the panel, and in the operator's narrow
      // panel the buttons sat on top of it). The wheel still zooms.
      zoom: phone
        ? { controls: false, wheel: false, pinch: true, startScale: 0.75, maxScale: 2, minScale: 0.3 }
        : { controls: zoomControls, wheel: true, startScale: 0.9, maxScale: 2.5, minScale: 0.3 },
    });
    workspaceRef.current = workspace;

    try {
      Blockly.serialization.workspaces.load(JSON.parse(migrateSpinBlocks(state)), workspace);
    } catch {
      // Ignore malformed state; an empty read-only canvas is an acceptable fallback.
    }

    requestAnimationFrame(() => {
      Blockly.svgResize(workspace);
      // Blocks carry the coordinates they were authored at, so a mission built
      // off to one side opened showing empty canvas and the learner had to
      // hunt for it. scrollCenter (not zoomToFit) keeps the scale the viewer
      // was configured with and only moves the viewport.
      if (fit) {
        workspace.zoomToFit();
        // Capped: a two-block program fitted to a big panel would be
        // comically large.
        if (workspace.getScale() > maxFitScale) workspace.setScale(maxFitScale);
        workspace.scrollCenter();
      } else {
        workspace.scrollCenter();
      }
      setReady(true);
    });

    return () => {
      setReady(false);
      workspaceRef.current = null;
      workspace.dispose();
    };
    // phone is read once at inject, like the editor's options; a change of
    // layout re-injects.
  }, [loaded, state, phone, fit, maxFitScale, zoomControls]);

  if (loadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <p>Couldn&apos;t load the block viewer.</p>
        <button
          onClick={() => {
            setLoadError(false);
            setRetryToken((n) => n + 1);
          }}
          className="clay-press rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading blocks...
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={divRef} className={`h-full w-full${phone ? ' roverBlocklyPhone' : ''}`} />
      <RunningBlockOverlay marks={marks} />
    </div>
  );
}
