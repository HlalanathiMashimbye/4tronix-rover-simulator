'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import type { PreFlightCheckId, PreFlightResult } from '@/core/domain/safety/preFlightChecks';
import {
  MISSION_MAX_DURATION_SECONDS,
  MISSION_MIN_DURATION_SECONDS,
} from '@/core/domain/safety/limits';

/**
 * Plain-English label for a check - presentation only, not domain logic.
 *
 * Same split ChallengeChecklistPanel uses: the domain says which rules there
 * are and whether they pass, and this says it in words a nine-year-old can act
 * on. Rewording a line touches this file and nothing in core.
 */
function describeCheck(id: PreFlightCheckId): string {
  switch (id) {
    case 'simulation-run':
      return 'You have watched it in the simulator';
    case 'rover-moves':
      return 'The rover moves';
    case 'runs-long-enough':
      return `It runs for at least ${MISSION_MIN_DURATION_SECONDS} seconds`;
    case 'within-time-limit':
      return `It finishes within ${MISSION_MAX_DURATION_SECONDS} seconds`;
  }
}

/**
 * What to do about a check that has not passed.
 *
 * Gives the RULE, not the verdict - the pattern learnerCodeCheck sets out.
 * "Too short" sends a child looking for a longer drive block; naming the pause
 * tells them what to type.
 */
function explainCheck(id: PreFlightCheckId, duration: number): string {
  switch (id) {
    case 'simulation-run':
      return 'Press Run to try this mission in the simulator first. The rover is real and there is a queue - the simulator is where a mistake is free.';
    case 'rover-moves':
      return 'Nothing here drives the rover. Add a Move Forward block, or a line like rover.forward(60).';
    case 'runs-long-enough':
      return (
        `This mission runs for ${formatSeconds(duration)}. Starting the motors does not wait ` +
        `for them - add a pause after the drive command so the rover has time to go somewhere.`
      );
    case 'within-time-limit':
      return (
        `This mission runs for about ${Math.round(duration)} seconds, and a turn on the rover ` +
        `is ${MISSION_MAX_DURATION_SECONDS}. Shorten a drive, or repeat it fewer times.`
      );
  }
}

/** "0 seconds", "1 second", "2.5 seconds" - no trailing .0 in the common case. */
function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
}

/**
 * The pre-flight checklist above the Send button.
 *
 * Ticks are computed from the current code on every render (runPreFlightChecks
 * is a pure parse), so this fills itself in as the learner builds rather than
 * waiting for them to press anything - the point is to answer "is my mission
 * ready" before the queue does.
 *
 * Only the FIRST unmet check explains itself. Three hints at once is a wall of
 * text on a panel that is already sharing its column with the simulator, and
 * the checks are close enough to sequential that the first one is nearly always
 * the one to act on.
 *
 * Deliberately mirrors ChallengeChecklistPanel's tick vocabulary - filled green
 * CheckCircle2 against a hollow muted Circle. A learner arriving from the
 * challenges flow has already learnt what those two icons mean.
 */
interface PreFlightChecklistProps {
  result: PreFlightResult;
}

export function PreFlightChecklist({ result }: PreFlightChecklistProps) {
  const firstUnmet = result.checks.find((check) => !check.passed);

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Pre-flight checks
        </h4>
        {result.ready && (
          <span className="text-[0.65rem] font-bold text-buzz">Ready to fly</span>
        )}
      </div>

      <ul className="mt-1.5 space-y-1">
        {result.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-1.5 text-xs">
            {check.passed ? (
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-buzz" />
            ) : (
              <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={check.passed ? 'text-foreground' : 'text-muted-foreground'}>
              {describeCheck(check.id)}
            </span>
          </li>
        ))}
      </ul>

      {firstUnmet && (
        <p className="mt-1.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
          {explainCheck(firstUnmet.id, result.duration)}
        </p>
      )}
    </div>
  );
}
