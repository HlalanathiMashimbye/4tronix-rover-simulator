'use client';

/**
 * The ordering control, shared by the navbar and its mobile counterpart.
 *
 * A native select rather than a custom menu: it is one element, it is keyboard
 * and screen-reader correct with no work, and on a phone it opens the
 * platform picker, which is better than anything worth building here. The
 * options come from the domain, so the navbar has no opinion about what the
 * orderings are.
 *
 * TWO SHAPES, because the two bars have very different room. The navbar's
 * middle column is 34rem and already carries a field and four chips; a
 * labelled control there cost the input so much width that "Search missions"
 * rendered as "Sea". So the navbar gets an icon, sized like the filter chips
 * beside it, with the current ordering in its tooltip and its accessible name.
 * The mobile bar has a row to itself and shows the words.
 *
 * Renders nothing unless the page registered itself as sortable, for the same
 * reason the chips only appear on pages that registered filters: a control
 * that does nothing is worse than no control.
 */

import { ArrowUpDown } from 'lucide-react';

import { useSearch } from '@/contexts/SearchContext';
import { MISSION_SORTS, isMissionSort } from '@/core/domain/services/missionSort';

export function SortSelect({
  variant = 'icon',
  className = '',
}: {
  variant?: 'icon' | 'labelled';
  className?: string;
}) {
  const { sort, setSort, sortable } = useSearch();

  if (!sortable) return null;

  const current = MISSION_SORTS.find((s) => s.key === sort);
  const label = `Sort missions: ${current?.label ?? ''}`;

  const options = MISSION_SORTS.map((s) => (
    <option key={s.key} value={s.key} className="bg-card text-foreground">
      {s.label}
    </option>
  ));

  const onChange = (value: string) => {
    if (isMissionSort(value)) setSort(value);
  };

  if (variant === 'labelled') {
    return (
      <label
        className={`inline-flex items-center gap-1.5 rounded-full text-muted-foreground transition-colors hover:text-foreground ${className}`}
      >
        <ArrowUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{label}</span>
        <select
          value={sort}
          onChange={(e) => onChange(e.target.value)}
          className="cursor-pointer appearance-none bg-transparent py-0.5 pr-1 text-xs font-medium text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {options}
        </select>
      </label>
    );
  }

  return (
    // Sized to match the icon-only filter chips it sits next to. The select is
    // laid over the icon at zero opacity rather than hidden, so it keeps the
    // native picker, the keyboard behaviour and the focus ring for free.
    <span
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${className}`}
      title={label}
    >
      <ArrowUpDown className="pointer-events-none h-3.5 w-3.5" aria-hidden />
      <select
        value={sort}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options}
      </select>
    </span>
  );
}
