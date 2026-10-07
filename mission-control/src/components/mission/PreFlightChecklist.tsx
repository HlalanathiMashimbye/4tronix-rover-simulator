'use client';

import { Eye, Hourglass, Mountain, Move, ShieldCheck, Timer, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PreFlightCheck, PreFlightCheckId, PreFlightResult } from '@/core/domain/safety/preFlightChecks';
import {
  MISSION_MAX_DURATION_SECONDS,
  MISSION_MIN_DURATION_SECONDS,
} from '@/core/domain/safety/limits';

/**
 * Plain-English label for a check - presentation only, not domain logic.
 *
 * Same split ChallengeInstructionsPanel uses: the domain says which rules there
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
    case 'no-crash':
      return 'It does not hit a rock or the edge of the yard';
    case 'flat-ground':
      return 'It stays off the slopes round the mound peaks';
  }
}

/**
 * What to do about a check that has not passed.
 *
 * Gives the RULE, not the verdict - the pattern learnerCodeCheck sets out.
 * "Too short" sends a child looking for a longer drive block; naming the pause
 * tells them what to type.
 */
function explainCheck(id: PreFlightCheckId, result: PreFlightResult): string {
  const { duration, crash } = result;
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
    case 'no-crash':
      // Where, not just whether: the simulator marks the spot in red, and the
      // time says which part of the program got it there.
      if (!crash) return 'Press Run to see whether your rover hits anything.';
      return crash.into === 'rock'
        ? `Your rover hits a rock ${formatSeconds(crash.atSeconds)} in, and the real one would too. ` +
            'Change the route to go round it: the red mark in the simulator shows where.'
        : `Your rover reaches the edge of the yard ${formatSeconds(crash.atSeconds)} in. ` +
            'Make a drive shorter, or turn before the wall: the red mark in the simulator shows where.';
    case 'flat-ground': {
      // A warning that leaves the choice with the learner (AB#468): what the
      // slope may do to the real rover, and that they can still send it.
      const { slope } = result;
      if (!slope) return 'Press Run to see whether your route climbs a slope.';
      // Short: beside the chips on a laptop this has three lines of about 40
      // letters, and "you can still send it" must not be the part cut off.
      const when = `at ${formatSeconds(slope.atSeconds)}`;
      return slope.level === 'red'
        ? `Over a mound's top ${when}. The real rover may tip or stall there. You can still send it.`
        : slope.level === 'orange'
          ? `A steep slope ${when}. The real rover will likely slip there, so its run may differ. You can still send it.`
          : `A gentle slope ${when}. The real rover may drift there, so its run may differ. You can still send it.`;
    }
  }
}

/** "0 seconds", "1 second", "2.5 seconds" - no trailing .0 in the common case. */
function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
}

/** Each check as one chip: what it is about, in an icon and a word or two. */
const CHIP: Record<PreFlightCheckId, { icon: LucideIcon; label: string }> = {
  'simulation-run': { icon: Eye, label: 'Watched' },
  'rover-moves': { icon: Move, label: 'Moves' },
  'runs-long-enough': { icon: Timer, label: `${MISSION_MIN_DURATION_SECONDS}s+` },
  'within-time-limit': { icon: Hourglass, label: `Under ${MISSION_MAX_DURATION_SECONDS}s` },
  'no-crash': { icon: ShieldCheck, label: 'No crash' },
  'flat-ground': { icon: Mountain, label: 'Flat' },
};

/**
 * The pre-flight checks above the Send button: one row of chips and one line
 * that says what to do next.
 *
 * ONE FIXED SHAPE. This sits in Create Mission's footer card, which is the
 * same height in every mode so nothing around it moves (AB#464). It was a
 * titled list of four sentences in one or two columns, plus a hint that
 * wrapped to three lines, and it pushed the yard around as it filled in. Now
 * the four checks are chips (the full sentence is each chip's name and
 * tooltip) and the hint is held to two lines, with all of it in the tooltip.
 *
 * Ticks are computed from the current code on every render (runPreFlightChecks
 * is a pure parse), so this fills itself in as the learner builds rather than
 * waiting for them to press anything.
 *
 * Only the FIRST unmet check explains itself: the checks are close enough to
 * sequential that the first one is nearly always the one to act on.
 *
 * Deliberately mirrors ChallengeInstructionsPanel's tick vocabulary - filled green
 * CheckCircle2 against a hollow muted Circle. A learner arriving from the
 * challenges flow has already learnt what those two icons mean.
 *
 * Wide (the card under a laptop's editor), the line sits beside the chips
 * rather than under them, which is a row the simulator gets back in height.
 */
interface PreFlightChecklistProps {
  result: PreFlightResult;
  /**
   * Whether there is any code yet. Before there is, the line invites rather
   * than explains: an empty workspace failing three checks reads as a mistake
   * the learner has made, when they have not started.
   */
  started?: boolean;
  /** Replaces the line, for news that outranks the checks: the mission went. */
  message?: ReactNode;
}

export function PreFlightChecklist({ result, started = true, message }: PreFlightChecklistProps) {
  // A check that holds up Send explains itself first. An advisory one, the
  // slopes, only once a run has been watched and nothing else is left: it is
  // the last thing to know before sending, not a reason the button is grey.
  const firstUnmet =
    result.checks.find((check) => !check.passed && !check.advisory) ??
    result.checks.find((check) => advisoryWarns(check, result));
  const hint = !started
    ? 'Build a mission, then press Run to watch it in the simulator.'
    : firstUnmet
      ? explainCheck(firstUnmet.id, result)
      : null;
  const warning = firstUnmet !== undefined && advisoryWarns(firstUnmet, result);

  return (
    <div className="min-w-0 @min-[40rem]:flex @min-[40rem]:items-center @min-[40rem]:gap-3">
      <ul aria-label="Pre-flight checks" className="flex shrink-0 items-center gap-1">
        {result.checks.map((check) => {
          const { icon: Icon, label } = CHIP[check.id];
          const sentence = describeCheck(check.id);
          return (
            <li
              key={check.id}
              aria-label={`${sentence}: ${check.passed ? 'done' : advisoryWarns(check, result) ? 'no, but you can still send it' : 'not yet'}`}
              title={sentence}
              data-passed={check.passed}
              data-warns={advisoryWarns(check, result) || undefined}
              className={`check-chip flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold transition-colors duration-300 ${
                check.passed
                  ? 'bg-buzz/15 text-buzz'
                  : advisoryWarns(check, result)
                    ? 'bg-amber-500/15 text-amber-600'
                    : 'bg-muted/70 text-muted-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {/* Words only where all six fit (about 27rem). Below that they
                  cut to "Watch..." and "2...", which says less than the icon;
                  the full sentence is each chip's name and tooltip. */}
              <span className="hidden truncate @min-[27rem]:inline">{label}</span>
            </li>
          );
        })}
      </ul>

      <p
        className={`mt-1 line-clamp-2 min-h-[2lh] text-[11px] leading-snug @min-[40rem]:mt-0 @min-[40rem]:min-w-0 @min-[40rem]:flex-1 @min-[40rem]:line-clamp-3 ${
          warning ? 'font-medium text-amber-600' : 'text-muted-foreground'
        }`}
        title={typeof hint === 'string' ? hint : undefined}
      >
        {message ?? (hint ?? <span className="font-bold text-buzz">Ready to send</span>)}
      </p>
    </div>
  );
}

/** An advisory check a watched run did not meet: amber, a warning, not a block. */
function advisoryWarns(check: PreFlightCheck, result: PreFlightResult): boolean {
  return !!check.advisory && !check.passed && !!result.slope;
}
