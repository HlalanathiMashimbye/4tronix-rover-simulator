/**
 * What an operator needs to know before sending a mission to the real rover.
 *
 * The console showed the learner's code and nothing else, so judging whether
 * a mission was safe to run meant reading Python and imagining the rover, or
 * leaving the console to watch it somewhere else. This reads the same answers
 * off the simulation and the existing checks, so the operator gets them in one
 * glance beside a replay.
 *
 * Built from rules that already have a home, never a second copy of them:
 * learnerCodeCheck for problems in the code, preFlightChecks for whether it
 * moves, calculatePythonDuration and the limits for how long it runs, and
 * crashCheck for where it hits a rock or the edge of the yard.
 *
 * THE YARD IS THE MEASURED ONE (AB#464), rocks and walls, from the start
 * mark, so a crash here means a real rock or a real wall. A crash is a stop:
 * a learner cannot send one any more (the pre-flight check, AB#466), so one
 * in the queue predates that, and the operator should not send it as it is.
 * It is still a prediction: the rover is put on the mark by hand and its
 * speed was calibrated on one battery charge, so the wording says where the
 * run is headed rather than promising the crash.
 */

import type { TrajectoryPoint } from '@/lib/simulateCommands';
import { checkLearnerCode } from '@/core/domain/safety/learnerCodeCheck';
import { movesTheRover } from '@/core/domain/safety/preFlightChecks';
import { calculatePythonDuration } from '@/core/domain/safety/calculateMissionDuration';
import { MISSION_MAX_DURATION_SECONDS, MISSION_MIN_DURATION_SECONDS } from '@/core/domain/safety/limits';
import { findCrash } from '@/core/domain/safety/crashCheck';
import { findSlope } from '@/core/domain/safety/slopeCheck';

/** stop: do not send it as it is. warn: look before sending. ok: nothing to see. */
export type FindingLevel = 'stop' | 'warn' | 'ok';

export interface PreviewFinding {
  id: 'code' | 'moves' | 'crash' | 'slope' | 'duration';
  level: FindingLevel;
  message: string;
  /** The same in a couple of words, for a phone's one-line summary. */
  short: string;
  /** Seconds into the run, for a finding that happens at a moment. */
  atSeconds?: number;
}

const ORDER: Record<FindingLevel, number> = { stop: 0, warn: 1, ok: 2 };

export function previewMission(code: string, trajectory: TrajectoryPoint[]): PreviewFinding[] {
  const findings: PreviewFinding[] = [];

  const problems = checkLearnerCode(code);
  findings.push(
    problems.length > 0
      ? {
          id: 'code',
          level: 'stop',
          message: `${problems.length} problem${problems.length === 1 ? '' : 's'} in the code. Line ${problems[0].line}: ${problems[0].message}`,
          short: `Code: line ${problems[0].line}`,
        }
      : { id: 'code', level: 'ok', message: 'The code checks out', short: 'Code OK' },
  );

  if (!movesTheRover(code)) {
    findings.push({ id: 'moves', level: 'warn', message: 'It never moves the rover', short: 'Never moves' });
  }

  const crash = findCrash(trajectory);
  findings.push(
    !crash
      ? { id: 'crash', level: 'ok', message: 'Hits nothing: no rock, no wall', short: 'No crash' }
      : crash.into === 'rock'
        ? {
            id: 'crash',
            level: 'stop',
            message: `Hits rock ${crash.rock} at ${formatSeconds(crash.atSeconds)}`,
            short: `${crash.rock} at ${formatSeconds(crash.atSeconds)}`,
            atSeconds: crash.atSeconds,
          }
        : {
            id: 'crash',
            level: 'stop',
            message: `Reaches the edge of the yard at ${formatSeconds(crash.atSeconds)}`,
            short: `Edge at ${formatSeconds(crash.atSeconds)}`,
            atSeconds: crash.atSeconds,
          },
  );

  // A slope is something to look at, never a stop (AB#468): the zones are
  // drawn by eye, the run may still go fine, and the learner was told.
  const slope = findSlope(trajectory);
  const ground = { yellow: 'a gentle slope', orange: 'a steep slope', red: "a mound's top" } as const;
  // At most ten letters: a time takes up to six more, and a phone's line holds
  // sixteen. "Gentle slope 2.9s" was seventeen once the yellow covered the
  // whole mound and nearly every run crossed it.
  const groundShort = { yellow: 'Slope', orange: 'Steep', red: 'Mound top' } as const;
  findings.push(
    !slope
      ? { id: 'slope', level: 'ok', message: 'Stays on flat ground', short: 'Flat' }
      : {
          id: 'slope',
          level: 'warn',
          message: `Climbs ${ground[slope.level]} at ${formatSeconds(slope.atSeconds)}: the run may not match`,
          short: `${groundShort[slope.level]} ${formatSeconds(slope.atSeconds)}`,
          atSeconds: slope.atSeconds,
        },
  );

  const duration = calculatePythonDuration(code);
  findings.push(
    duration > MISSION_MAX_DURATION_SECONDS
      ? { id: 'duration', level: 'stop', message: `Runs ${formatSeconds(duration)}, over the ${MISSION_MAX_DURATION_SECONDS}s limit`, short: `${formatSeconds(duration)}, too long` }
      : duration < MISSION_MIN_DURATION_SECONDS
        ? { id: 'duration', level: 'warn', message: `Only runs ${formatSeconds(duration)}`, short: `Only ${formatSeconds(duration)}` }
        : { id: 'duration', level: 'ok', message: `Runs ${formatSeconds(duration)}`, short: formatSeconds(duration) },
  );

  // Worst first, so the line an operator reads first is the one that matters.
  return findings.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}

function formatSeconds(seconds: number): string {
  return `${Math.round(seconds * 10) / 10}s`;
}
