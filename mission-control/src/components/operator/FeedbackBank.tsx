'use client';

import { useState } from 'react';
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
 * The reviewed message bank (AB#471), one click from the note box.
 *
 * Picking a message fills the box rather than sending it: the operator can
 * still edit it, add the learner's name, or ignore the bank and write their
 * own, and Send stays the one way a note leaves the console.
 *
 * Opens on the group the run most likely belongs in (suggestFeedbackOutcome),
 * and says why when that is a crash, since the suggestion comes from the
 * preview's simulation and not from watching the real rover - the operator
 * has seen the real run and may know better.
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
  const suggested = suggestFeedbackOutcome(status, crash);
  const [outcome, setOutcome] = useState<FeedbackOutcome>(suggested);

  return (
    <div className="mt-2">
      <div role="group" aria-label="Ready-written notes" className="flex flex-wrap gap-1">
        {OUTCOMES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={outcome === key}
            onClick={() => setOutcome(key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              outcome === key
                ? 'border-primary/60 bg-primary/15 text-foreground'
                : 'border-border/60 text-muted-foreground hover:text-foreground'
            }`}
          >
            {FEEDBACK_OUTCOME_LABELS[key]}
            {key === suggested && <span className="font-normal text-muted-foreground"> (suggested)</span>}
          </button>
        ))}
      </div>

      {crash && outcome === 'crash' && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          The preview hits {crashThing(crash)}
          {crash.rock ? ` (${crash.rock})` : ''} at {crash.atSeconds}s.
        </p>
      )}

      <ul className="mt-1.5 space-y-1">
        {FEEDBACK_MESSAGES[outcome].map((template) => {
          const message = fillFeedbackMessage(template, crash);
          return (
            <li key={template}>
              <button
                type="button"
                onClick={() => onPick(message)}
                className="w-full rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/60"
              >
                {message}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
