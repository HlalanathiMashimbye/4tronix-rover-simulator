'use client';

/**
 * Search and status filters on a phone.
 *
 * NavbarSearch is `hidden md:flex`, so below that breakpoint there was no
 * search and no filters at all - on the device most learners use, and on the
 * pages whose whole job is finding one mission among a hundred.
 *
 * It is a separate component rather than the navbar one unhidden, for two
 * reasons. The navbar field carries min-w-[20rem] and pr-40 so the chips can
 * sit overlaid inside it, which does not fit 375px. And the navbar is a fixed
 * h-16 that eleven pages size themselves against with calc(100vh-64px); a
 * second row would make that height depend on whether the current page
 * registered filters, which is not something a CSS variable can know.
 *
 * So the page renders this, where there is width to spare and no height
 * contract to break. Both controls stay visible - hiding search behind an icon
 * loses on the same grounds the bottom tab bar was chosen over a hamburger: a
 * control a child cannot see is a control they do not have.
 */

import { useReducedMotion } from 'motion/react';
import { Search, X } from 'lucide-react';

import { useSearch } from '@/contexts/SearchContext';
import { ActivePillBackground } from '@/components/ui/ActivePillBackground';

export function MobileSearch() {
  const { query, setQuery, activeFilter, setActiveFilter, filters } = useSearch();
  const reduceMotion = useReducedMotion();

  // Same rule as the navbar: a page that registered no filters has nothing to
  // search, so this is not a control it should show.
  if (filters.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-2 pb-2 md:hidden">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search missions"
          aria-label="Search missions by name or code"
          className="h-11 w-full rounded-full border border-border/60 bg-card/60 pl-10 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Labelled, unlike the navbar's icon-only chips. There is room for the
          words here, and a filter whose meaning has to be guessed from a glyph
          is one a child will not use. The count comes too, so "Completed 12"
          says how much is behind it before it is tapped. */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]"
        role="group"
        aria-label="Filter missions by status"
      >
        {filters.map((f) => {
          const active = activeFilter === f.key;
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              aria-pressed={active}
              className={`relative isolate inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-transparent text-primary-foreground'
                  : 'border-border/60 bg-card/50 text-muted-foreground'
              }`}
            >
              {active && (
                <ActivePillBackground
                  layoutId="mobile-filter-pill"
                  className="rounded-full bg-gradient-mars"
                  reduceMotion={reduceMotion}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {f.label}
                <span className={active ? 'text-primary-foreground/75' : 'text-muted-foreground/70'}>
                  {f.count}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
