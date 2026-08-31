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
 */
export function OperatorFeedback({ runs }: { runs: MissionRun[] }) {
  const withFeedback = runs.filter((run) => run.feedback && run.feedback.trim().length > 0);

  if (withFeedback.length === 0) return null;

  return (
    <section
      aria-label="Notes from the yard"
      className="shrink-0 rounded-xl border border-primary/30 bg-primary/5 p-3"
    >
      <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
        <MessageSquare className="h-3.5 w-3.5" />
        {withFeedback.length > 1 ? 'Notes from the yard' : 'A note from the yard'}
      </h2>

      <ul className="mt-2 flex flex-col gap-2.5">
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
    </section>
  );
}
