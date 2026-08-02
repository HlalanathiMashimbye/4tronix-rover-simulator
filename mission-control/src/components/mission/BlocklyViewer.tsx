'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { defineRoverBlocks } from './roverBlockly';

// Pinned - keep in sync with BlocklyEditor.tsx's copy of this same URL. See
// that file for why: an unversioned unpkg URL can break every page load the
// moment a new Blockly release ships, with no local change and no warning.
const BLOCKLY_CDN_URL = 'https://unpkg.com/blockly@13.2.0/blockly.min.js';

/**
 * Read-only Blockly rendering of a saved workspace (mission.blocklyState).
 *
 * Loads Blockly from the same CDN as the editor and renders the program without
 * a toolbox, so learners can see the blocks they will remix. Pan/zoom stay on
 * (scrollbars + wheel) but editing is off. window.Blockly is typed by the
 * editor's global declaration.
 */
export function BlocklyViewer({ state }: { state: string }) {
  const divRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const scriptLoadedRef = useRef(false);
  const [retryToken, setRetryToken] = useState(0);

  // Load Blockly from CDN (mirrors BlocklyEditor).
  useEffect(() => {
    if (typeof window === 'undefined' || scriptLoadedRef.current) return;
    if (window.Blockly) {
      scriptLoadedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync that the CDN script is already present
      setLoaded(true);
      return;
    }
    setLoadError(false);
    const script = document.createElement('script');
    script.src = BLOCKLY_CDN_URL;
    script.async = true;
    script.onload = () => {
      scriptLoadedRef.current = true;
      setLoaded(true);
    };
    script.onerror = () => {
      script.remove();
      setLoadError(true);
    };
    document.body.appendChild(script);
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
      Blockly.serialization.workspaces.load(JSON.parse(state), workspace);
    } catch {
      // Ignore malformed state; an empty read-only canvas is an acceptable fallback.
    }

    requestAnimationFrame(() => Blockly.svgResize(workspace));

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
