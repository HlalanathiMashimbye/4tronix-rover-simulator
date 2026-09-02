'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';

import { yardLabelOf, type Yard } from '@/core/domain/entities/Yard';

/**
 * Where this operator is working, and why they cannot change it here.
 *
 * This was a dropdown. Changing yards mid-shift by opening a select is how a
 * Cape Town run gets recorded against Durban, and nobody finds out until a
 * child's video turns up in the wrong city. The yard is chosen at sign-in and
 * fixed for the session now, so this states the fact and, when clicked, says
 * what to do about it rather than looking inert.
 */
export function YardChip({ yard }: { yard: Yard | null }) {
  const [explaining, setExplaining] = useState(false);

  if (!yard) {
    return (
      <a
        href="/operator"
        className="clay inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300"
      >
        <MapPin className="h-3.5 w-3.5" />
        No yard chosen. Sign in again.
      </a>
    );
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setExplaining((open) => !open)}
        aria-expanded={explaining}
        className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/70"
      >
        <MapPin className="h-3.5 w-3.5 text-primary" />
        {yardLabelOf(yard)}
      </button>

      {explaining && (
        <span
          role="note"
          className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-border/70 bg-popover p-3 text-xs leading-relaxed text-muted-foreground shadow-card"
        >
          Every mission you run is recorded at <b className="text-foreground">{yard.city}</b>.
          To work at another yard, sign out and sign in again there. It is deliberately not
          a switch: a mission recorded at the wrong place is hard to notice and harder to undo.
        </span>
      )}
    </span>
  );
}
