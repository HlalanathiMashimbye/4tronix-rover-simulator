'use client';

import { RotateCcw } from 'lucide-react';

/**
 * Drive mode's half of Create Mission's footer card (AB#464).
 *
 * The card is one fixed height in every mode, so nothing moves when a learner
 * switches between driving and building. Drive has nothing to send, so it
 * uses the card for putting the rover back on the start spot and the keys
 * that drive it.
 */
export function DriveFooter({ onResetPosition }: { onResetPosition: () => void }) {
  return (
    <div className="@container flex h-full flex-col justify-between gap-1.5">
      <p className="line-clamp-2 min-h-[2lh] text-[11px] leading-snug text-muted-foreground">
        Drive is for practising: nothing here goes to the real rover. To send a mission, build it in Blocks or Python.
      </p>
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onResetPosition}
          className="clay-press flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:border-primary"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset position
        </button>
        <span className="hidden text-right text-[11px] text-muted-foreground @min-[22rem]:block">
          Keys: W A S D, Q E, space to stop
        </span>
      </div>
    </div>
  );
}
