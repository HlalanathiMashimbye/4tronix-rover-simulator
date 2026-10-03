'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Code2, Play } from 'lucide-react';
import { loadBlockly } from '@/infrastructure/browser/loadBlockly';
import {
  defineRoverBlocks,
  migrateSpinBlocks,
  mergeUplinkHats,
  workspaceToPython,
  workspaceToCommands,
  type CommandSource,
  type SimulationCommand,
} from '@/lib/roverBlockly';
import { blocklyInjectOptions } from '@/components/mission/blocklyInjectOptions';
import { calculateBlocklyDuration } from '@/core/domain/safety/calculateMissionDuration';
import { MISSION_TIME_LIMIT_SECONDS } from '@/core/domain/safety/limits';

/** Where the run markers sit over the canvas, in px from its top-left. */
interface LoopMark {
  key: string;
  left: number;
  top: number;
  /** "2 / 3": which pass of the Repeat is running. */
  label: string;
}
interface RunMarks {
  step: { left: number; top: number } | null;
  loops: LoopMark[];
}

interface BlocklyEditorProps {
  onGenerateCommands: (commands: SimulationCommand[]) => void;
  onCodeChange?: (code: string) => void;
  onBlocklyStateChange?: (state: string) => void;
  /** Switch to the Python tab, showing what these blocks generate. */
  onShowAsPython?: () => void;
  /** What the simulator is running right now (AB#450). */
  highlight?: CommandSource | null;
  /**
   * Inject the phone options (blocklyInjectOptions), read once at inject, and
   * drop the Run row: on a phone Run lives in the top bar (onRegisterRun).
   */
  phone?: boolean;
  /** Hands this editor's Run up, for a Run button outside it. */
  onRegisterRun?: (run: (() => void) | null) => void;
}

// Hub-local storage of the serialized workspace. Separate origin from the yard,
// so the key name need not match - but the JSON format does (Blockly.serialization).
//
// There is no incoming "initial state" prop here: this key IS the editor's only
// source of truth for what to load, so anything wanting to seed the editor has
// to write this key before the component mounts.
const STORAGE_KEY = 'roverWorkspace';

export function BlocklyEditor({ onGenerateCommands, onCodeChange, onBlocklyStateChange, onShowAsPython, highlight = null, phone = false, onRegisterRun }: BlocklyEditorProps) {
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
  /** Seconds this workspace runs for, when that is over the ceiling. */
  const [overBudget, setOverBudget] = useState<number | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Loading is owned by infrastructure/browser/loadBlockly, which the mission
  // page has usually already started in the background.
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

      // Initialize workspace with the shared category toolbox. Read once:
      // EditorPanel remounts this component when the layout changes.
      const workspace = Blockly.inject(blocklyDivRef.current, blocklyInjectOptions(phone));

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
          Blockly.serialization.workspaces.load(JSON.parse(migrateSpinBlocks(saved)), workspace);
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

      // Centre whatever we just put on the canvas. Saved workspaces keep the
      // coordinates they were dragged to, and a remix carries the coordinates
      // of whoever built it, so opening the editor could land on empty canvas
      // with the program off-screen. Deliberately scrollCenter and not
      // zoomToFit: the learner's zoom level is theirs, and rescaling on open
      // is the behaviour the recenter button was removed for (see below).
      // After a frame, so it measures the container at its final size.
      requestAnimationFrame(() => {
        if (workspaceRef.current) workspaceRef.current.scrollCenter();
      });

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

      // Auto-save on every change, and keep the running time in view so the
      // ceiling is never a surprise at submit (AB#401).
      //
      // This used to undo the offending change and raise an alert(). Two
      // problems with that. Blockly fires this listener for UI events too -
      // clicks, selections, scrolling the canvas - so a workspace that was
      // already over the limit, a remix opened from a mission page or anything
      // saved before the ceiling existed, would rewind one real edit every time
      // the learner so much as clicked. And the undo ran between
      // disableEvents() and enableEvents() with no finally, so a throw in there
      // left events off and killed autosave for the rest of the session,
      // silently, inside the catch below.
      //
      // Warning instead of undoing keeps the learner's work theirs. Submit is
      // still a hard refusal, which is where the story puts the stop.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workspace.addChangeListener((event: any) => {
        // Selections and viewport moves change nothing worth measuring.
        if (event?.isUiEvent) return;
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(Blockly.serialization.workspaces.save(workspace))
          );

          const duration = calculateBlocklyDuration(workspace);
          const over = duration > MISSION_TIME_LIMIT_SECONDS ? Math.round(duration) : null;
          setOverBudget((previous) => (previous === over ? previous : over));
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
    // NEVER MEASURE A HIDDEN CANVAS. The phone's launch view collapses the
    // editor to nothing while the simulator plays (AB#455), and a Blockly
    // workspace resized to zero keeps its scroll position for a zero-sized
    // viewport: back in the editor, the program sat in the top-left corner.
    // So below a usable size this stops resizing altogether, and when the
    // canvas comes back it recentres once it has finished growing, measured
    // as no resize for a moment rather than a guess at the animation's length.
    let collapsed = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      const height = blocklyDivRef.current?.clientHeight ?? 0;
      if (height < 40) {
        collapsed = true;
        return;
      }
      if (collapsed) {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          collapsed = false;
          const workspace = workspaceRef.current;
          if (!workspace) return;
          window.Blockly.svgResize(workspace);
          workspace.scrollCenter();
        }, 120);
      }
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
      if (settleTimer) clearTimeout(settleTimer);

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

  // Re-registered every render: handleRun reads this render's props.
  useEffect(() => {
    onRegisterRun?.(handleRun);
    return () => onRegisterRun?.(null);
  });

  // There is deliberately no custom recenter button. Blockly's own zoom-reset
  // control (the target icon above the +/- buttons, enabled by zoom.controls
  // below) already does the job: measured, it returns the scale to 1.0 AND
  // re-centers the blocks in the viewport. A second button that called
  // zoomToFit() used to sit at the bottom of the canvas, which meant two
  // recenter controls with different behaviour - zoomToFit re-scales to fit
  // the content, so it could leave the blocks tiny or oversized rather than
  // back at a normal size.

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
    const host = blocklyDivRef.current;
    if (!isInitialized || !workspace || !host) return;
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
        step: stepRect
          ? { left: stepRect.right - frame.left + 6, top: stepRect.top - frame.top + Math.min(stepRect.height, 40) / 2 }
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
  }, [highlightKey, isInitialized]);

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
    <div ref={containerRef} className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden md:gap-2.5">
      {/* The buttons are ONE GROUP, pinned right.
          Adding "Show as Python" as a third child of a justify-between row made
          it the middle item, so it parked in the centre of whatever space was
          left and drifted on its own as the panel resized. Grouping the two
          buttons and pushing the pair right with ml-auto keeps them together at
          every width; the hint text yields first, then hides. */}
      {/* Not on a phone, where the hint has no room, Run is in the top bar and
          the Python tab shows the blocks by itself: the row was 40px of a
          canvas that needs every one. */}
      {!phone && (
      <div className="flex flex-wrap items-center gap-2">
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
          Stack blocks inside “On uplink”, tune the numbers, then run it.
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Lives on the BLOCKS side, not in the Python tab, because this is
              where the question occurs to a learner: they are looking at their
              blocks and want to know what they look like as code. */}
          {onShowAsPython && (
            <button
              onClick={onShowAsPython}
              title="See the Python your blocks make"
              className="clay clay-press flex shrink-0 items-center gap-1.5 rounded-xl border border-border/70 bg-card px-2.5 py-1.5 text-xs font-semibold md:px-3 md:py-2 text-foreground transition-colors hover:border-primary/70"
            >
              <Code2 className="h-3.5 w-3.5 text-primary" />
              Show as Python
            </button>
          )}
          <button
            onClick={handleRun}
            className="clay clay-press flex shrink-0 items-center gap-1.5 rounded-xl bg-buzz px-3 py-1.5 text-xs font-bold text-background md:px-3.5 md:py-2"
          >
            <Play className="h-3.5 w-3.5" fill="currentColor" />
            Run blocks
          </button>
        </div>
      </div>
      )}

      {mergedNotice && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-xl border border-buzz/40 bg-buzz/10 p-2 text-xs">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-buzz" />
          <p className="text-buzz">Merged an extra uplink into one mission.</p>
        </div>
      )}

      {overBudget !== null && (
        <div
          role="status"
          className="flex flex-shrink-0 items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-destructive">
            This mission runs for about {overBudget} seconds. The most a mission can take is{' '}
            {MISSION_TIME_LIMIT_SECONDS}, so shorten a drive or repeat it fewer times before you
            send it.
          </p>
        </div>
      )}

      <div className="panel-inner relative min-h-0 flex-1 overflow-hidden border-2 border-border bg-white">
        <div
          ref={blocklyDivRef}
          // Scopes the phone toolbox rules in globals.css: the left-column
          // widths there would otherwise squeeze the bottom strip.
          className={`h-full w-full min-h-0 overflow-hidden${phone ? ' roverBlocklyPhone' : ''}`}
          style={{ width: '100%' }}
        />
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
      </div>
    </div>
  );
}
