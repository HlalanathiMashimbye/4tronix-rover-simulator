'use client';

import { useSearch } from '@/contexts/SearchContext';

/**
 * The queue's views as a bottom tab bar, on a phone.
 *
 * The four filters - the queue, what still needs a video, what needs review,
 * what is done - are the places an operator moves between during a shift.
 * On a laptop they are chips beside the search field; at 390px the same
 * chips overflowed the row and half of them were off the screen, which is
 * the one thing navigation must never be. A tab bar is the pattern both
 * platforms' guidelines give for exactly this: a small, fixed set of peer
 * views (Apple's HIG allows three to five; this has five), always visible,
 * in the strip of the screen a thumb reaches without adjusting its grip.
 *
 * It is NOT a hamburger. Hiding these behind an icon would have halved how
 * often they are used, which is what the research on hidden navigation
 * measures, and a filter the operator does not open is a run whose video
 * never gets attached.
 *
 * Reads the same registry the chips read, so a filter added to the console
 * appears here without this file knowing. Renders nothing on a page that
 * registered none.
 */
export function OperatorTabBar({
  /**
   * Called after a filter is chosen. The queue uses it to close an open
   * mission: below lg the panes take turns, and a tab that changes a list the
   * operator cannot see has not visibly done anything.
   */
  onSelect,
}: {
  onSelect?: (key: string) => void;
}) {
  const { filters, activeFilter, setActiveFilter } = useSearch();

  if (filters.length === 0) return null;

  return (
    // In the flow at the foot of the page, NOT position: fixed. Every page
    // renders inside PageTransition, whose will-change: transform makes it the
    // containing block for fixed descendants, so "fixed, bottom: 0" put this
    // bar at the bottom of the page area instead of the viewport - 64px too
    // high on an iPhone, with the last queue rows sliding under it and a dead
    // band below. The learner's bar gets away with fixed because Navbar
    // renders outside that wrapper. This one cannot, so the console's main
    // runs to the viewport's bottom edge (see --app-bottom-chrome) and the
    // bar is its last child.
    <nav
      aria-label="Queue views"
      className="-mx-3 shrink-0 border-t border-border/50 bg-card/85 backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch justify-around px-1">
        {filters.map((f) => {
          const active = activeFilter === f.key;
          const Icon = f.icon;
          const showCount = f.count !== null && f.count > 0;

          return (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setActiveFilter(f.key);
                onSelect?.(f.key);
              }}
              aria-current={active ? 'true' : undefined}
              // The whole column is the target, not the icon: 64px tall and
              // a fifth of the width, which is well over the 44pt minimum.
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" aria-hidden="true" />
                {showCount && (
                  <span
                    className={`absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 ring-2 ring-card ${
                      f.key === 'review'
                        ? 'bg-amber-500 text-amber-950'
                        : 'bg-primary text-primary-foreground'
                    }`}
                  >
                    {f.count}
                  </span>
                )}
              </span>
              <span className="truncate">{f.shortLabel ?? f.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
