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
 * moves, calculatePythonDuration and the limits for how long it runs. The one
 * new fact is where the simulated rover meets the edge of the yard.
 *
 * THE EDGE IS THE SIMULATOR'S YARD, not the real one: there is no overlay of
 * the real yard and no fixed start position yet, so the console says so in
 * its wording rather than promising a crash or its absence.
 */

import type { TrajectoryPoint } from '@/lib/simulateCommands';
import { STEP_SECONDS } from '@/lib/simulateCommands';
import { checkLearnerCode } from '@/core/domain/safety/learnerCodeCheck';
import { movesTheRover } from '@/core/domain/safety/preFlightChecks';
import { calculatePythonDuration } from '@/core/domain/safety/calculateMissionDuration';
import { MISSION_MAX_DURATION_SECONDS, MISSION_MIN_DURATION_SECONDS } from '@/core/domain/safety/limits';

/** stop: do not send it as it is. warn: look before sending. ok: nothing to see. */
export type FindingLevel = 'stop' | 'warn' | 'ok';

export interface PreviewFinding {
  id: 'code' | 'moves' | 'edge' | 'duration';
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

  const hit = trajectory.findIndex((point) => point.hitWall);
  // Rounded to the tenth the words say: step 53 is 5.300000000000001 seconds
  // in floating point, and a time the message calls 5.3 should be 5.3.
  const hitAt = Math.round(hit * STEP_SECONDS * 10) / 10;
  findings.push(
    hit >= 0
      ? {
          id: 'edge',
          level: 'warn',
          message: `Reaches the edge of the simulator's yard at ${formatSeconds(hitAt)}`,
          short: `Edge at ${formatSeconds(hitAt)}`,
          atSeconds: hitAt,
        }
      : { id: 'edge', level: 'ok', message: "Stays inside the simulator's yard", short: 'Stays inside' },
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
