'use client';

import type { ReactNode } from 'react';
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
 * null, so the row does not appear out of nowhere and shove the layout the
 * first time somebody writes something. Saying "No operator note yet" also
 * tells a child that a note is a thing that can arrive, and from whom.
 *
 * `ask` is for a mission that has finished and has no note yet. The line then
 * goes on to point at the Remix button the page puts beside it. That prompt
 * was a full-width banner of its own above the player, a row of every screen,
 * nowhere near the button it was about. For a while it was this slot's whole
 * line ("How did it go? Remix it to go further or fix it."), and the slot no
 * longer said whose it was: the review of 13 October 2026 looked at it and
 * asked where the operator's feedback had gone. So the line always opens by
 * naming the operator, and the prompt is what follows. A note, once there is
 * one, replaces both: a person's answer beats our prompt.
 *
 * WHERE IT IS, which is three places (MissionVideoClient decides):
 *
 * On a phone, a bar at the foot of the page, where it has to stay a bar: two
 * lines of the note and no more.
 *
 * Beside the feed or the videos (a tablet, a laptop), set into the foot of
 * the code's card, which has height to give, so from `md` the note is shown
 * whole. An operator can write 280 characters (the cap in
 * api/operator/missions), about eight lines in the narrowest card, and a note
 * cut short on a tablet cannot be read at all: there is no hover there to
 * show the rest. The name of who wrote it drops under the note when the two
 * do not fit on a line. From `md` the slot asks for 15rem before it will
 * share a line with Remix, and takes all the room going: Remix then wraps
 * under it and fills that line (RemixButton).
 *
 * Under the one video of three columns. A single video is all in view, and
 * what is left of its column under it would be empty; that is where the
 * review of 13 October 2026 said the comment should go. There it is `roomy`:
 * a card that takes that room, the words at a size to be read from a chair,
 * and whatever the page hands it (Remix) with them. An empty card with a
 * sentence in one corner read as a hole with a border. With more than one
 * video the column is a list and the note is back in the code's card, so the
 * videos have all of it.
 */
export function OperatorFeedback({
  runs,
  ask = false,
  roomy = false,
  children,
}: {
  runs: MissionRun[];
  ask?: boolean;
  /** It has a box to fill rather than a line to keep to. */
  roomy?: boolean;
  /** What goes under the words in the roomy card: the next thing to press. */
  children?: ReactNode;
}) {
  const withFeedback = runs
    .filter((run) => run.feedback && run.feedback.trim().length > 0)
    // Newest first. Runs written before feedbackAt existed sort last rather
    // than winning on an undefined compare.
    .sort((a, b) => (b.feedbackAt ?? '').localeCompare(a.feedbackAt ?? ''));

  const note = withFeedback[0];
  const others = withFeedback.length - 1;
  const tone = note ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-card/50';
  const author = note && (
    <>
      {note.feedbackBy || 'Your operator'}
      {others > 0 && ` +${others}`}
    </>
  );
  const nothingYet = (
    <>
      <span className="font-display font-bold text-foreground">No operator note yet.</span>{' '}
      {ask ? 'Remix it to go further or fix it.' : 'One can arrive after your rover run.'}
    </>
  );

  if (roomy) {
    return (
      // .noteCard lays the three out by the height it turns out to have
      // (globals.css): in a row while the box is short, stacked and centred
      // once it is tall. The box scrolls if a long note meets a short one.
      <section
        aria-label="Notes from the yard"
        className={`noteCard flex min-h-0 min-w-0 flex-1 overflow-y-auto rounded-2xl border px-4 py-3 ${tone}`}
      >
        <div className="noteCardInner">
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              note ? 'bg-primary/15 text-primary' : 'bg-foreground/10 text-muted-foreground'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="noteCardWords">
            {note ? (
              <>
                <p className="text-sm leading-relaxed text-foreground">{note.feedback}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{author}</p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground [&>span]:block [&>span]:text-base">
                {nothingYet}
              </p>
            )}
          </div>
          {children}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Notes from the yard"
      className={`flex min-h-10 min-w-0 flex-[999_1_0%] items-center gap-x-2 gap-y-0.5 rounded-xl border px-3 py-1.5 text-xs md:basis-60 md:flex-wrap ${tone}`}
    >
      {/* The icon and the words are one thing to the line they are on: only
          the name wraps away from them. md:basis-80 is the width under which
          the note would rather have the line to itself. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 md:basis-80 md:items-start">
        <MessageSquare className={`h-3.5 w-3.5 shrink-0 md:mt-px ${note ? 'text-primary' : 'text-muted-foreground'}`} />

        {note ? (
          <p className="line-clamp-2 min-w-0 flex-1 text-foreground md:line-clamp-none" title={note.feedback}>
            {note.feedback}
          </p>
        ) : (
          <p className="line-clamp-2 min-w-0 flex-1 text-muted-foreground md:line-clamp-none [&>span]:text-sm">
            {nothingYet}
          </p>
        )}
      </div>

      {note && <p className="ml-auto shrink-0 text-[11px] text-muted-foreground">{author}</p>}
    </section>
  );
}
