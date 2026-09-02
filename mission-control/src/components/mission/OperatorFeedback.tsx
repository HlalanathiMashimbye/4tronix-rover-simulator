'use client';

import { MessageSquare } from 'lucide-react';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

/**
 * What an operator wrote back to the learner about their run.
 *
 * Read from every run rather than from the watchable ones the carousel shows.
 * buildRunOptions deliberately drops runs without a video, which includes the
 * runs that did not work - and a run that did not work is exactly the one a
 * child needs a sentence about. Hanging this off the carousel would have hidden
 * feedback in the only case it really matters.
 *
 * One line, one note. This was a growing panel, and the height it took was
 * height the player did not get: the video ended 236px short of the code panel
 * beside it. The newest note is the one that survives, because the others are
 * older advice about the same code. When there are more, the count says so
 * rather than letting them disappear quietly.
 *
 * It holds its line when there is nothing to show yet rather than rendering
 * null, so the row below the stats does not appear out of nowhere and shove
 * the layout the first time somebody writes something. Saying "no notes yet"
 * also tells a child that a note is a thing that can arrive.
 */
export function OperatorFeedback({ runs }: { runs: MissionRun[] }) {
  const withFeedback = runs
    .filter((run) => run.feedback && run.feedback.trim().length > 0)
    // Newest first. Runs written before feedbackAt existed sort last rather
    // than winning on an undefined compare.
    .sort((a, b) => (b.feedbackAt ?? '').localeCompare(a.feedbackAt ?? ''));

  const note = withFeedback[0];
  const others = withFeedback.length - 1;

  return (
    <section
      aria-label="Notes from the yard"
      className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs ${
        note ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-card/50'
      }`}
    >
      <MessageSquare
        className={`h-3.5 w-3.5 shrink-0 ${note ? 'text-primary' : 'text-muted-foreground'}`}
      />

      {note ? (
        <>
          <p className="min-w-0 flex-1 truncate text-foreground" title={note.feedback}>
            {note.feedback}
          </p>
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {note.feedbackBy || 'Your operator'}
            {others > 0 && ` +${others}`}
          </p>
        </>
      ) : (
        <p className="min-w-0 flex-1 truncate text-muted-foreground">
          No notes yet. Your operator can leave one after watching your run.
        </p>
      )}
    </section>
  );
}
