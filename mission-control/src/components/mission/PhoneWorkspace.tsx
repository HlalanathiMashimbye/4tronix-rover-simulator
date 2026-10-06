'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Blocks, ChevronLeft, Code2, Maximize2, Minimize2, Play, Square } from 'lucide-react';
import { useOnScreenKeyboard } from '@/hooks/useIsPhoneLayout';
import { preventIosInputZoom } from '@/infrastructure/browser/iosInputZoom';

/**
 * Create Mission on a phone: the "docked sim" layout (AB#455).
 *
 * Editing, and while a run plays:
 *   top bar     back, Run (Stop while a run plays)
 *   sim strip   half the screen, expandable
 *   editor      the other half, the running block or line lit up
 *
 * When a run has played to its end (the launch view):
 *   top bar     Back to blocks / Back to code
 *   simulator   most of the screen, the rover where it finished
 *   launch      the pre-flight checks, the mission's name, Submit
 *
 * WHY THE CODE STAYS FOR THE RUN. Run used to open the launch view at once,
 * which slid the editor away just as the program started: the highlight
 * showing which block or line the rover is on (AB#450) played to nobody,
 * and that is the whole point of running a program to test it (6 Oct 2026).
 *
 * WHY THE LAUNCH VIEW STILL OPENS BY ITSELF. Submitting used to sit behind a
 * Send button that only appeared once a run had been watched to its last
 * frame, and then behind a sheet. On a phone nobody found it: there was, in
 * practice, no way to submit a mission. So the end of a run still takes the
 * learner to everything submitting needs, without a button to find. Stop
 * does not: stopping is for changing something. Nor does a run ending while
 * the keyboard is up, which would pull the editor out from under the
 * learner's typing.
 *
 * The docked strip was chosen over Build/Watch tabs and a floating mini-sim
 * because it is the only one where a learner sees the program and the rover
 * at once while editing.
 *
 * Layout only. Every piece is built and owned by MissionWorkspace and passed
 * in as a slot, so running, submitting and the highlight have one
 * implementation whichever layout is on screen. The editor stays MOUNTED in
 * the launch view, only hidden: unmounting it would throw away Blockly's
 * workspace and the registered Run.
 */
interface PhoneWorkspaceProps {
  editor: React.ReactNode;
  simulator: React.ReactNode;
  /** The checks, name and Submit. Absent in Drive, which sends nothing. */
  submitBar?: React.ReactNode;
  /** Runs the active editor's program in the simulator. */
  onRun: () => void;
  /** A run is playing out now, so the top bar offers Stop instead of Run. */
  running?: boolean;
  /** Pauses the run where it is. */
  onStop?: () => void;
  /**
   * Goes up by one each time a run is watched to its end. The launch view
   * opens when it does (see above); its value at mount is not an ending.
   */
  runEnded?: number;
  /** Which editor the launch view returns to, for its button's words. */
  editorKind: 'blocks' | 'code';
  /** The launch view, owned by MissionWorkspace so a successful send can close it. */
  launchOpen: boolean;
  onLaunchOpenChange: (open: boolean) => void;
  /**
   * The line the simulator is running, for the one-line strip shown while the
   * keyboard is up. null when nothing is running or there is no line to show.
   */
  runningText?: string | null;
}

/** How long the rover rests where it finished before the launch view rises. */
const LAUNCH_AFTER_MS = 700;

export function PhoneWorkspace({
  editor,
  simulator,
  submitBar,
  onRun,
  running = false,
  onStop,
  runEnded = 0,
  editorKind,
  launchOpen,
  onLaunchOpenChange,
  runningText = null,
}: PhoneWorkspaceProps) {
  const [simExpanded, setSimExpanded] = useState(false);
  const keyboard = useOnScreenKeyboard();
  // Drive has no launch view: nothing to submit.
  const launching = launchOpen && submitBar !== undefined;

  // Lets the code be phone-sized: see preventIosInputZoom.
  useEffect(() => preventIosInputZoom(), []);

  // Give up the screen the keyboard covers, through the same token the tab
  // bar uses (h-page subtracts it), so the editor ends above the keys instead
  // of behind them. Inline on <html> because it outranks the stylesheet's
  // zero for this surface, and is removed the moment the keyboard goes.
  useEffect(() => {
    const root = document.documentElement;
    if (keyboard.inset > 0) root.style.setProperty('--app-bottom-chrome', `${keyboard.inset}px`);
    else root.style.removeProperty('--app-bottom-chrome');
    return () => {
      root.style.removeProperty('--app-bottom-chrome');
    };
  }, [keyboard.inset]);

  // The end of a run opens the launch view. What it needs to know at that
  // moment is read through a ref, so the timer is only ever restarted by a
  // run ending, not by the parent re-rendering with fresh props.
  const canLaunch = submitBar !== undefined && !keyboard.open;
  const launchRef = useRef({ canLaunch, onLaunchOpenChange });
  useEffect(() => {
    launchRef.current = { canLaunch, onLaunchOpenChange };
  });
  const endedAtMount = useRef(runEnded);
  useEffect(() => {
    if (runEnded === endedAtMount.current || !launchRef.current.canLaunch) return;
    const timer = setTimeout(() => {
      if (launchRef.current.canLaunch) launchRef.current.onLaunchOpenChange(true);
    }, LAUNCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [runEnded]);

  return (
    // data-launch drives the move between editing and launching in
    // globals.css (.phoneWorkspace): the simulator grows, the launch controls
    // slide up, the editor slides away, and back. Everything stays mounted so
    // there is something to animate, and what is off screen is inert.
    <div data-launch={launching} className="phoneWorkspace flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2">
        <Link
          href="/"
          aria-label="Back to home"
          className="-ml-1 flex items-center gap-0.5 rounded-lg px-1 py-1 text-sm font-bold text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
          <span className="font-display">
            Build your <span className="text-gradient-mars">Mission</span>
          </span>
        </Link>

        {submitBar &&
          (launching ? (
            // Says where it goes, not what it does: "Edit" left a learner
            // unsure whether they would lose the run they were watching.
            <button
              onClick={() => onLaunchOpenChange(false)}
              className="clay clay-press flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground"
            >
              {editorKind === 'code' ? <Code2 className="h-3.5 w-3.5" /> : <Blocks className="h-3.5 w-3.5" />}
              {editorKind === 'code' ? 'Back to code' : 'Back to blocks'}
            </button>
          ) : running && onStop ? (
            // In Run's place and at Run's size, so nothing in the bar moves.
            <button
              onClick={onStop}
              // A ring, not a border, which would make it 2px bigger than Run.
              className="clay clay-press flex items-center gap-1.5 rounded-xl bg-card px-3 py-1.5 text-xs font-bold text-foreground ring-1 ring-inset ring-border"
            >
              <Square className="h-3.5 w-3.5 text-destructive" fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              onClick={onRun}
              className="clay clay-press flex items-center gap-1.5 rounded-xl bg-buzz px-3 py-1.5 text-xs font-bold text-background"
            >
              <Play className="h-3.5 w-3.5" fill="currentColor" />
              Run
            </button>
          ))}
      </div>

      {/* While the keyboard is up the strip shrinks to one line, so the
          editor keeps the little screen that is left. The simulator stays
          mounted and keeps playing underneath: the line it is running shows
          here, and the highlight in the editor carries on. In the launch view
          it takes whatever the launch controls leave. */}
      <div
        data-expanded={simExpanded}
        data-keyboard={keyboard.open && !launching}
        data-launch={launching}
        // No frame of its own: the simulator frames itself, and stretches the
        // yard to fill it (AB#464), so a frame here would be a second outline.
        className="phoneSimStrip relative"
      >
        {simulator}
        {launching ? null : keyboard.open ? (
          <div className="absolute inset-0 z-20 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 text-xs" aria-live="polite">
            <Play className="h-3 w-3 shrink-0 text-buzz" fill="currentColor" />
            <span className="truncate font-mono text-foreground">
              {runningText ?? <span className="font-sans text-muted-foreground">Simulator is hidden while you type</span>}
            </span>
          </div>
        ) : (
          <button
            onClick={() => setSimExpanded((expanded) => !expanded)}
            aria-label={simExpanded ? 'Shrink the simulator' : 'Enlarge the simulator'}
            aria-expanded={simExpanded}
            className="absolute right-1.5 top-1.5 z-20 rounded-lg bg-black/45 p-1.5 text-white backdrop-blur-sm"
          >
            {simExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
      </div>

      {submitBar && (
        <div className="phoneLaunchSlot" inert={!launching}>
          <section aria-label="Send your mission" aria-hidden={!launching} className="phoneLaunch">
            {submitBar}
          </section>
        </div>
      )}

      <div className="phoneEditorSlot" inert={launching} aria-hidden={launching}>
        {editor}
      </div>
    </div>
  );
}
