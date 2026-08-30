'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { loadBlockly } from '@/lib/loadBlockly';
import { defineRoverBlocks, migrateSpinBlocks } from '@/lib/roverBlockly';

/**
 * Read-only Blockly rendering of a saved workspace (mission.blocklyState).
 *
 * Shares lib/loadBlockly with the editor - one script, one cache - and renders
 * the program without a toolbox, so learners can see the blocks they will
 * remix. Pan/zoom stay on (scrollbars + wheel) but editing is off.
 */
export function BlocklyViewer({ state }: { state: string }) {
  const divRef = useRef<HTMLDivElement>(null);
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
      zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 2.5, minScale: 0.3 },
    });

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
      workspace.scrollCenter();
    });

    return () => workspace.dispose();
  }, [loaded, state]);

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

  return <div ref={divRef} className="h-full w-full" />;
}
