'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, MonitorPlay, Play } from 'lucide-react';

import { describeRuns, type RunOption } from '@/lib/missionRuns';

/**
 * Choosing which run to watch.
 *
 * WHY A FILMSTRIP RATHER THAN CHIPS OR A DROPDOWN.
 *
 * It started as a dropdown, which was the original problem: a closed <select>
 * shows one option, so a child had no way to know a real rover had driven
 * their code. Chips fixed the discoverability and did not scale - six of them
 * wrap into a block of text that pushes the video off a phone screen.
 *
 * A poster frame does the job text cannot. A child scanning this sees an
 * actual rover on actual dirt and understands immediately that the thing ran
 * somewhere real, before reading a single label. Six of those scroll
 * horizontally without costing the video any height, which is the constraint
 * that matters on a phone.
 *
 * The strip scrolls rather than wraps for the same reason: wrapping grows
 * downward without limit, and vertical space is what the video needs.
 *
 * It is a carousel in the Netflix sense - several cards visible, scroll for
 * more - and deliberately not the one-at-a-time kind. Showing a single run
 * behind arrows would put the other five back out of sight, which is the exact
 * problem the dropdown had. Arrows appear on desktop when there is overflow,
 * because a row that happens to fit should not pretend it has more.
 */
export function RunStrip({
  runs,
  selectedId,
  onSelect,
}: {
  runs: RunOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  // Measured from a ref callback and a scroll handler rather than an effect:
  // both run after the DOM already exists, so there is no render-time write
  // and no cascading update to reason about.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setOverflow({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      setTrack(el);
      measure(el);
    },
    [measure],
  );

  const nudge = (direction: -1 | 1) => {
    // Roughly two cards, so a click makes visible progress without skipping
    // past anything unseen.
    track?.scrollBy({ left: direction * 240, behavior: 'smooth' });
  };

  // One run means no choice to make, and a strip of one looks like a mistake.
  if (runs.length < 2) return null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="px-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {describeRuns(runs)}
      </p>

      <div className="relative min-w-0">
        {overflow.left && (
          <button
            aria-label="Scroll to earlier runs"
            onClick={() => nudge(-1)}
            className="clay absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-border/60 bg-card/95 p-1.5 text-foreground backdrop-blur transition-colors hover:border-primary/70 sm:block"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {overflow.right && (
          <button
            aria-label="Scroll to more runs"
            onClick={() => nudge(1)}
            className="clay absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 rounded-full border border-border/60 bg-card/95 p-1.5 text-foreground backdrop-blur transition-colors hover:border-primary/70 sm:block"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

      <div
        ref={attach}
        onScroll={(e) => measure(e.currentTarget)}
        role="tablist"
        aria-label="Choose a run to watch"
        // snap-x so a thumb-flick lands on a card rather than between two.
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {runs.map((run) => {
          const active = run.id === selectedId;

          return (
            <button
              key={run.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(run.id)}
              className={`group clay-press w-[104px] shrink-0 snap-start overflow-hidden rounded-xl border text-left transition-colors sm:w-[124px] ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border/60 bg-card hover:border-primary/50'
              }`}
            >
              <div className="relative aspect-video w-full overflow-hidden bg-muted">
                {run.thumbnailUrl ? (
                  <Image
                    src={run.thumbnailUrl}
                    alt=""
                    fill
                    sizes="124px"
                    className="object-cover"
                    // A poster frame is decoration for a control that is
                    // already labelled; never block the strip on it.
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-transparent">
                    <MonitorPlay className="h-6 w-6 text-primary" />
                  </div>
                )}

                {run.kind === 'real' && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/25 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="h-5 w-5 fill-current text-foreground" />
                  </span>
                )}
              </div>

              <div className="px-2 py-1.5">
                <p className="truncate text-[11px] font-bold leading-tight text-foreground">
                  {run.label}
                </p>
                <p
                  className={`truncate text-[10px] leading-tight ${
                    active ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {run.sublabel}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
