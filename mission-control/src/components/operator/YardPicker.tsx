'use client';

import { useSyncExternalStore } from 'react';
import { MapPin } from 'lucide-react';

import {
  KNOWN_YARDS,
  readStoredYard,
  selectYard,
  serverYardSnapshot,
  subscribeToYard,
} from '@/infrastructure/config/yards';

/**
 * Which yard this operator is working at right now.
 *
 * A choice, not a permission. Nothing server-side checks it: an operator is an
 * operator anywhere, and the yard only decides which queue they are looking at
 * and which rover a run belongs to.
 *
 * The selection lives in localStorage, which is an external store, so it is
 * read with useSyncExternalStore rather than pulled into state by an effect.
 * The separate server snapshot is what keeps SSR and hydration agreeing.
 */
export function YardPicker({ onChange }: { onChange?: (yardId: string) => void }) {
  const yardId = useSyncExternalStore(subscribeToYard, readStoredYard, serverYardSnapshot);

  function select(next: string) {
    selectYard(next);
    onChange?.(next);
  }

  // A single yard is a statement of fact, not a decision to make. Showing a
  // dropdown of one is a worse experience than showing where you are.
  if (KNOWN_YARDS.length === 1) {
    return (
      <span className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs font-medium text-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        {KNOWN_YARDS[0].name}, {KNOWN_YARDS[0].area}
      </span>
    );
  }

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Yard</span>
      <span className="clay inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card py-1.5 pl-3 pr-1.5 text-xs font-medium text-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <select
          value={yardId}
          onChange={(e) => select(e.target.value)}
          className="cursor-pointer bg-transparent pr-1 text-xs font-medium text-foreground outline-none"
        >
          {KNOWN_YARDS.map((yard) => (
            <option key={yard.id} value={yard.id}>
              {yard.name}, {yard.area}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
