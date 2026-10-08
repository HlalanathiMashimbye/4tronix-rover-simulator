'use client';

import { useId } from 'react';
import type { Crash } from '@/core/domain/safety/crashCheck';
import type { MissionStatus } from '@/core/domain/entities/Mission';
import {
  FEEDBACK_MESSAGES,
  FEEDBACK_OUTCOME_LABELS,
  crashThing,
  fillFeedbackMessage,
  suggestFeedbackOutcome,
  type FeedbackOutcome,
} from '@/core/domain/services/feedbackMessages';

const OUTCOMES = Object.keys(FEEDBACK_MESSAGES) as FeedbackOutcome[];

/**
 * The reviewed message bank (AB#471), as one dropdown above the note box.
 *
 * A dropdown rather than a list of buttons: seventeen sentences laid out in
 * the panel pushed the note box and the runs below the fold, for a choice an
 * operator makes once per run. A native select, grouped by outcome, is one
 * row, works with a keyboard and a screen reader as it is, and on a phone
 * opens the system picker.
 *
 * Choosing a note fills the box rather than sending it: the operator can
 * still edit it, add the learner's name, or ignore the bank and write their
 * own, and Send stays the one way a note leaves the console. The select goes
 * back to its prompt after each choice, so it never shows a note the operator
 * has since edited away, and choosing the same note again puts it back.
 *
 * The group the run most likely belongs in (suggestFeedbackOutcome) is listed
 * first and marked, and when that is a crash the line underneath says why -
 * the suggestion comes from the preview's simulation, not from watching the
 * real rover, and the operator has seen the real run.
 */
export function FeedbackBank({
  status,
  crash,
  onPick,
}: {
  status: MissionStatus;
  crash: Crash | null;
  onPick: (message: string) => void;
}) {
  const id = useId();
  const suggested = suggestFeedbackOutcome(status, crash);
  const order = [suggested, ...OUTCOMES.filter((outcome) => outcome !== suggested)];

  return (
    <div className="mt-2">
      <label htmlFor={id} className="text-[11px] font-semibold text-muted-foreground">
        Ready-written notes
      </label>
      <select
        id={id}
        value=""
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
        className="mt-1 w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <option value="">Choose a note to start from...</option>
        {order.map((outcome) => (
          <optgroup
            key={outcome}
            label={`${FEEDBACK_OUTCOME_LABELS[outcome]}${outcome === suggested ? ' (suggested)' : ''}`}
          >
            {FEEDBACK_MESSAGES[outcome].map((template) => {
              const message = fillFeedbackMessage(template, crash);
              return (
                <option key={template} value={message}>
                  {message}
                </option>
              );
            })}
          </optgroup>
        ))}
      </select>

      {crash && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          The preview hits {crashThing(crash)}
          {crash.rock ? ` (${crash.rock})` : ''} at {crash.atSeconds}s.
        </p>
      )}
    </div>
  );
}
