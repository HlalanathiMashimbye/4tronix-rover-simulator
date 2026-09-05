'use client';

/**
 * The search field and its inline filter chips, living in the navbar.
 *
 * Renders nothing at all when no page has registered filters, which is how it
 * disappears on Create Mission and the mission detail pages - see
 * SearchContext for why that is a registry rather than a route check.
 *
 * SHOWN FROM lg, NOT md, AND THE THRESHOLD WAS MEASURED.
 *
 * The chips sit overlaid inside the field, so the field needs room for both.
 * Rendered at a range of widths, the space actually left to type in:
 *
 *     768px  ->  -102px   chips overlap the text outright
 *     900px  ->    30px   not overlapping, and not usable either
 *    1024px  ->   154px   workable
 *
 * 768 is an iPad Mini in portrait, which is the worst possible place to put
 * the boundary: the layout is broken at exactly the width a common device
 * reports. Below lg the page renders MobileSearch instead, which stacks the
 * chips under a full-width field and has room to label them.
 */

import { useReducedMotion } from 'motion/react';
import { Search, X } from 'lucide-react';
import { useSearch } from '@/contexts/SearchContext';
import { ActivePillBackground } from '@/components/ui/ActivePillBackground';
import { SortSelect } from './SortSelect';

export function NavbarSearch() {
  const { query, setQuery, activeFilter, setActiveFilter, filters } = useSearch();
  const reduceMotion = useReducedMotion();

  // No registered filters means this page has nothing to search. The wrapper
  // still renders: it holds the navbar grid's middle column, and returning
  // null here would let the action cluster slide into the centre.
  const hasSearch = filters.length > 0;

  return (
    // Keep the search centered and only adjust the input's own width.
    <div className="hidden min-w-0 lg:flex">
    {!hasSearch ? null : (
    // Nudged left of true centre to balance the busier right-hand cluster, but
    // only a little: at 15% the filter chips slid underneath the nav pill and
    // sat on top of the "Home" link.
    <div className="relative mx-auto w-full max-w-[34rem] lg:translate-x-[4%]">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search missions"
        aria-label="Search missions by name or code"
        // Right padding clears the chips, which are absolutely positioned over
        // the field so the whole thing reads as one control rather than an
        // input with a toolbar bolted on.
        className="h-10 w-full min-w-[20rem] rounded-full border border-border/60 bg-card/60 pl-10 pr-44 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary lg:pr-48"
      />

      <div
        className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1"
        role="group"
        aria-label="Filter missions by status"
      >
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <SortSelect />

        <span className="h-6 w-px bg-border/70" aria-hidden />

        {filters.map((f) => {
          const active = activeFilter === f.key;
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              aria-pressed={active}
              title={`${f.label} (${f.count})`}
              className={`relative isolate inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full transition-colors ${
                active
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
              }`}
            >
              {active && (
                <ActivePillBackground
                  layoutId="feed-filter-pill"
                  className="rounded-full bg-gradient-mars"
                  reduceMotion={reduceMotion}
                />
              )}
              <span className="relative z-10 inline-flex items-center justify-center">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {/* The icon alone is not a label, and the count is not rendered
                  anywhere visible - both only exist in the tooltip otherwise. */}
              <span className="sr-only">{`${f.label}, ${f.count} missions`}</span>
            </button>
          );
        })}
      </div>
    </div>
    )}
    </div>
  );
}
