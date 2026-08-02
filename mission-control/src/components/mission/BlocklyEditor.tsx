'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, CheckCircle2, AlertTriangle, Locate } from 'lucide-react';
import { loadBlockly } from '@/lib/loadBlockly';
import {
  defineRoverBlocks,
  ROVER_TOOLBOX,
  ROVER_MAX_INSTANCES,
  mergeUplinkHats,
  workspaceToPython,
  workspaceToCommands,
  type SimulationCommand,
} from './roverBlockly';

interface BlocklyEditorProps {
  onGenerateCommands: (commands: SimulationCommand[]) => void;
  onCodeChange?: (code: string) => void;
  onBlocklyStateChange?: (state: string) => void;
}

// Hub-local storage of the serialized workspace. Separate origin from the yard,
// so the key name need not match - but the JSON format does (Blockly.serialization).
const STORAGE_KEY = 'roverWorkspace';

export function BlocklyEditor({ onGenerateCommands, onCodeChange, onBlocklyStateChange }: BlocklyEditorProps) {
  const blocklyDivRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Holds the Blockly workspace instance (untyped CDN global).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspaceRef = useRef<any>(null);
  const flyoutObserverRef = useRef<MutationObserver | null>(null);
  const mergedNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [blocklyLoaded, setBlocklyLoaded] = useState(false);
  // Unset means still loading; the CDN fetch previously had no failure path
  // at all, so a network hiccup or ad-blocker left this stuck on the loading
  // spinner forever with no way out and nothing in the console to explain it.
  const [loadError, setLoadError] = useState(false);
  // Tells the learner their workspace just changed for a reason they didn't
  // cause - a leftover duplicate uplink from before the cap existed got
  // merged away on load. Without this, blocks they'd placed just vanish
  // from under them with no explanation, on a page that never even asked.
  const [mergedNotice, setMergedNotice] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Loading (and the Monaco/AMD conflict that used to make this silently
  // render an empty canvas) is handled in lib/loadBlockly.
  useEffect(() => {
    let cancelled = false;
    loadBlockly()
      .then(() => {
        if (!cancelled) setBlocklyLoaded(true);
      })
      .catch((err) => {
        console.error('[BlocklyEditor] Blockly failed to load:', err);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  useEffect(() => {
    if (!blocklyLoaded || !blocklyDivRef.current || !window.Blockly) return;
    if (workspaceRef.current) return; // Already initialized

    const timer = setTimeout(() => {
      if (!blocklyDivRef.current || !window.Blockly || workspaceRef.current) return;

      const Blockly = window.Blockly;

      // Register the shared rover blocks (same defs the yard uses).
      defineRoverBlocks(Blockly);

      // Initialize workspace with the shared category toolbox.
      const workspace = Blockly.inject(blocklyDivRef.current, {
        toolbox: ROVER_TOOLBOX,
        // The actual cap - Blockly reads maxInstances only from here, never
        // from a toolbox content entry, so this must live on inject() itself.
        maxInstances: ROVER_MAX_INSTANCES,
        renderer: 'zelos',
        zoom: {
          controls: true,
          wheel: true,
          startScale: 1.0,
          maxScale: 2.5,
          minScale: 0.35,
          scaleSpeed: 1.15,
        },
        grid: {
          spacing: 20,
          length: 3,
          colour: '#ccc',
          snap: true,
        },
        trashcan: true,
        move: {
          drag: true,
          scrollbars: true,
          wheel: true,
        },
      });

      workspaceRef.current = workspace;
      setIsInitialized(true);

      // Resize after paint so Blockly measures the final container dimensions.
      requestAnimationFrame(() => {
        Blockly.svgResize(workspace);
      });

      // Restore the saved workspace (JSON via Blockly.serialization), or start
      // with a fresh "On uplink" hat block - mirrors the yard's bootstrap.
      const startWithHat = () => {
        const block = workspace.newBlock('rover_on_receive');
        block.initSvg();
        block.render();
        block.moveBy(40, 40);
      };

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          Blockly.serialization.workspaces.load(JSON.parse(saved), workspace);
          if (mergeUplinkHats(workspace)) {
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify(Blockly.serialization.workspaces.save(workspace))
            );
            setMergedNotice(true);
            mergedNoticeTimerRef.current = setTimeout(() => setMergedNotice(false), 5000);
          }
        } catch (e) {
          console.warn('Failed to load saved workspace, starting fresh', e);
          workspace.clear();
          startWithHat();
        }
      } else {
        startWithHat();
      }

      // Blockly hides a flyout but leaves its scrollbar behind. Closing a
      // category left a 15x322 scrollbar sitting over the workspace, still
      // display:block with a visible handle, covering blocks underneath and
      // swallowing clicks meant for them.
      //
      // Each flyout is immediately followed in the DOM by its own scrollbar
      // (toolbox and trashcan each have a pair), so the fix is to mirror the
      // flyout's display onto the scrollbar whenever Blockly changes it.
      const syncFlyoutScrollbars = () => {
        blocklyDivRef.current
          ?.querySelectorAll<SVGElement>('.blocklyFlyout')
          .forEach((flyout) => {
            const scrollbar = flyout.nextElementSibling;
            if (!scrollbar?.classList.contains('blocklyFlyoutScrollbar')) return;
            const hidden = getComputedStyle(flyout).display === 'none';
            (scrollbar as SVGElement).style.display = hidden ? 'none' : '';
          });
      };

      // Runs once for the initial state too: the scrollbar ships visible even
      // before any category has been opened.
      syncFlyoutScrollbars();

      const flyoutObserver = new MutationObserver(syncFlyoutScrollbars);
      blocklyDivRef.current
        ?.querySelectorAll('.blocklyFlyout')
        .forEach((flyout) =>
          flyoutObserver.observe(flyout, { attributes: true, attributeFilter: ['style', 'class'] })
        );
      flyoutObserverRef.current = flyoutObserver;

      // Auto-save serialized state on every change.
      workspace.addChangeListener(() => {
        try {
          const state = Blockly.serialization.workspaces.save(workspace);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
          // Non-fatal - a transient change event during load can race; ignore.
        }
      });
    }, 200);

    return () => {
      clearTimeout(timer);
      flyoutObserverRef.current?.disconnect();
      flyoutObserverRef.current = null;
      if (mergedNoticeTimerRef.current) clearTimeout(mergedNoticeTimerRef.current);
    };
  }, [blocklyLoaded]);

  useEffect(() => {
    if (!isInitialized || !workspaceRef.current || !window.Blockly) return;

    const workspace = workspaceRef.current;
    // Coalesced to at most once per animation frame - the panel-split slider
    // (MissionWorkspace.tsx) now animates its CSS grid track with a
    // transition, which fires this ResizeObserver on every intermediate
    // frame of that transition, not just once per onChange. Without this,
    // a full Blockly svgResize (workspace metrics + toolbox/flyout layout)
    // ran on every one of those frames for the whole drag.
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (workspaceRef.current) {
          window.Blockly.svgResize(workspaceRef.current);
        }
      });
    };

    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);
    }

    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);

      if (workspaceRef.current === workspace) {
        workspace.dispose();
        workspaceRef.current = null;
        setIsInitialized(false);
      }
    };
  }, [isInitialized]);

  const handleRun = () => {
    if (!workspaceRef.current) return;

    const commands = workspaceToCommands(workspaceRef.current);
    if (commands.length === 0) {
      alert('Add some movement blocks inside "On uplink" first!');
      return;
    }

    onGenerateCommands(commands);
  };

  // Blockly's own built-in zoom controls include a reset-zoom button, but it
  // resets to the workspace's default scale/origin rather than fitting
  // whatever's actually been dragged around - easy to "lose" your blocks off
  // to one side after panning or zooming in. zoomToFit() re-scales and
  // re-centers on the actual current content instead.
  const handleRecenter = () => {
    workspaceRef.current?.zoomToFit();
  };

  // Listen for workspace changes and push the generated Python (and the
  // serialized Blockly state) up to the parent.
  useEffect(() => {
    if (!isInitialized || !workspaceRef.current) return;

    const workspace = workspaceRef.current;
    const listener = () => {
      onCodeChange?.(workspaceToPython(workspace));
      if (onBlocklyStateChange && window.Blockly) {
        onBlocklyStateChange(
          JSON.stringify(window.Blockly.serialization.workspaces.save(workspace))
        );
      }
    };

    workspace.addChangeListener(listener);

    // Initial generation
    listener();

    return () => {
      workspace.removeChangeListener(listener);
    };
  }, [isInitialized, onCodeChange, onBlocklyStateChange]);

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p>Couldn&apos;t load the block editor. Check your connection and try again.</p>
        <button
          onClick={() => {
            setLoadError(false);
            setRetryToken((n) => n + 1);
          }}
          className="clay clay-press rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!blocklyLoaded) {
    return (
      <div className="flex h-full items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
        Loading blocks...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          Stack blocks inside “On uplink”, tune the numbers, then run it.
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={handleRecenter}
            title="Recenter blocks"
            aria-label="Recenter blocks in view"
            className="clay-press flex items-center justify-center rounded-xl border border-border/60 bg-card/50 p-2 text-muted-foreground hover:text-foreground"
          >
            <Locate className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleRun}
            className="clay clay-press flex items-center gap-1.5 rounded-xl bg-buzz px-3.5 py-2 text-xs font-bold text-background"
          >
            <Play className="h-3.5 w-3.5" fill="currentColor" />
            Run blocks
          </button>
        </div>
      </div>

      {mergedNotice && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-xl border border-buzz/40 bg-buzz/10 p-2 text-xs">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-buzz" />
          <p className="text-buzz">Merged an extra uplink into one mission.</p>
        </div>
      )}

      <div
        ref={blocklyDivRef}
        className="min-h-0 flex-1 overflow-hidden rounded-xl border-2 border-border bg-white"
        style={{ width: '100%' }}
      />
    </div>
  );
}
