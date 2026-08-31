'use client';

import { MessageSquare } from 'lucide-react';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { yardPlace } from '@/infrastructure/config/yards';

/**
 * What an operator wrote back to the learner about their run.
 *
 * Read from every run rather than from the watchable ones the carousel shows.
 * buildRunOptions deliberately drops runs without a video, which includes the
 * runs that did not work - and a run that did not work is exactly the one a
 * child needs a sentence about. Hanging this off the carousel would have hidden
 * feedback in the only case it really matters.
 *
 * The yard is named only when more than one has written something, so the
 * usual case reads as a note rather than a log entry.
 *
 * This holds its space when there is nothing to show yet, rather than
 * rendering null. Two reasons, and neither is decorative: the panel used to
 * appear out of nowhere and shove the stats up the moment an operator wrote
 * something, and while it was absent the column ended short of the code panel
 * beside it. Saying "no notes yet" also tells a child that a note is a thing
 * that can arrive, which an empty space does not.
 */
export function OperatorFeedback({ runs }: { runs: MissionRun[] }) {
  const withFeedback = runs.filter((run) => run.feedback && run.feedback.trim().length > 0);
  const hasNotes = withFeedback.length > 0;

  return (
    <section
      aria-label="Notes from the yard"
      // flex-1, so this takes the column's leftover height and the column ends
      // level with the code panel beside it. A flex column stretches its
      // children across, not down, so being inside a grown wrapper was not
      // enough on its own.
      className={`flex min-h-0 flex-1 flex-col rounded-xl border p-3 ${
        hasNotes ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-card/50'
      }`}
    >
      <h2
        className={`flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${
          hasNotes ? 'text-primary' : 'text-muted-foreground'
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {withFeedback.length > 1 ? 'Notes from the yard' : 'A note from the yard'}
      </h2>

      {hasNotes ? (
        // Scrolls inside its own box rather than growing the column: the page
        // does not scroll on desktop, so a talkative operator would otherwise
        // push the stats off the bottom.
        <ul className="scroll-panel mt-2 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {withFeedback.map((run) => (
            <li key={run.yardId}>
              <p className="text-sm leading-relaxed text-foreground">{run.feedback}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {run.feedbackBy || 'Your operator'}
                {withFeedback.length > 1 && ` · ${yardPlace(run.yardId) ?? run.yardId}`}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          No notes yet. The operator who runs your code can leave one here after they watch it.
        </p>
      )}
    </section>
  );
}
