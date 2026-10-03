'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Maximize2, Minimize2, Play, Rocket, X } from 'lucide-react';

/**
 * Create Mission on a phone: the "docked sim" layout (AB#455).
 *
 *   top bar     back, Run (then Send)
 *   sim strip   ~30% of the screen, expandable
 *   editor      everything else
 *
 * Chosen over Build/Watch tabs and a floating mini-sim because it is the only
 * one where a learner sees the program and the rover at once, which is what
 * the running-block highlight (AB#450) is for. The page used to stack the
 * desktop panels and scroll, which put the simulator a whole screen below the
 * blocks.
 *
 * Layout only. Every piece is built and owned by MissionWorkspace and passed
 * in as a slot, so running, submitting and the highlight have one
 * implementation whichever layout is on screen.
 */
interface PhoneWorkspaceProps {
  editor: React.ReactNode;
  simulator: React.ReactNode;
  /** The name, checklist and launch button. Absent in Drive, which sends nothing. */
  submitBar?: React.ReactNode;
  /** Runs the active editor's program in the simulator. */
  onRun: () => void;
  /** Whether the program as it stands has been watched to the end. */
  watched: boolean;
  /** Whether the pre-flight checks pass, so Send can say so before it is opened. */
  sendReady: boolean;
  sendOpen: boolean;
  onSendOpenChange: (open: boolean) => void;
}

export function PhoneWorkspace({ editor, simulator, submitBar, onRun, watched, sendReady, sendOpen, onSendOpenChange }: PhoneWorkspaceProps) {
  const [simExpanded, setSimExpanded] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
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

        {/* ONE BUTTON: Run until this program has been watched to the end,
            then Send. Sending is only possible after watching, which the
            checklist already asked for, and the learner never has to find a
            second button for the next step. An edit turns it back into Run,
            because the edited program has not been watched. The editors'
            own Run buttons and Show as Python are gone on a phone; this and
            the Python tab replace them. */}
        {submitBar &&
          (watched ? (
            <button
              onClick={() => onSendOpenChange(true)}
              data-ready={sendReady}
              // Green once the checks pass, mission orange until then: the
              // same signal the launch button inside gives.
              className={`clay clay-press flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-primary-foreground ${
                sendReady ? 'bg-gradient-buzz' : 'bg-gradient-mars'
              }`}
            >
              <Rocket className="h-3.5 w-3.5" />
              Send
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

      <div
        data-expanded={simExpanded}
        // The outer radius, not panel-inner's: the strip sits beside the editor
        // card as a sibling, not inside it, and the two read as one family.
        className="phoneSimStrip relative shrink-0 overflow-hidden rounded-2xl border border-border"
      >
        {simulator}
        <button
          onClick={() => setSimExpanded((expanded) => !expanded)}
          aria-label={simExpanded ? 'Shrink the simulator' : 'Enlarge the simulator'}
          aria-expanded={simExpanded}
          className="absolute right-1.5 top-1.5 z-20 rounded-lg bg-black/45 p-1.5 text-white backdrop-blur-sm"
        >
          {simExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="min-h-0 flex-1">{editor}</div>

      {submitBar && (
        <SendSheet open={sendOpen} onClose={() => onSendOpenChange(false)}>
          {submitBar}
        </SendSheet>
      )}
    </div>
  );
}

/** How long the sheet takes to leave, so it is unmounted only after it has. */
const SHEET_EXIT_MS = 260;

/**
 * The launch controls, sliding up from the bottom edge.
 *
 * A sheet because a phone has no room to keep them on screen next to a
 * docked simulator, and the bottom edge is where a thumb already is. Mounted
 * only while open or leaving, the same pattern as MissionSentDialog.
 */
function SendSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the sheet is appearing
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), SHEET_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-[90] ${visible ? '' : 'pointer-events-none'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Send your mission"
    >
      <div
        className={`absolute inset-0 bg-black/55 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div data-visible={visible} className="sendSheet absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border/70 bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Send to the rover</p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
