import type { ChallengeCheckSpec } from '@/core/domain/entities/Challenge';
import type { ChallengeEvalContext } from '@/core/application/services/ChallengeCheckEvaluator';
import { missedGoal, pathMismatch } from '@/core/domain/services/challengeTarget';

/**
 * One check, in the words a learner (or their teacher) reads.
 *
 * Its own module because two places show it: the learner's step checklist in
 * ChallengeInstructionsPanel and the "how it is checked" list in the teacher
 * panel on the briefing. Two copies would drift, and the teacher would be
 * told something different from what the child sees.
 */
export function describeCheck(spec: ChallengeCheckSpec): string {
  switch (spec.kind) {
    case 'search-query':
      return spec.matches ? `Search for "${spec.matches}"` : 'Type something into the search box';
    case 'search-filter':
      return `Set the filter to "${spec.filterKey}"`;
    case 'load-more':
      return 'Load another page of missions';
    case 'route-visited':
      return ROUTE_LABELS[spec.path] ?? `Open ${spec.path}`;
    case 'mission-created':
      return 'Send a mission to the queue';
    case 'trajectory-outcome':
      return `Rover ${spec.outcome.replace('-', ' ')}`;
    case 'code-contains':
      return CODE_CONTAINS_LABELS[spec.pattern] ?? 'Use the right command';
    case 'prediction-made':
      return 'Pick your prediction';
    case 'reaches-target':
      return 'Stop the rover on the target';
    case 'matches-target':
      return 'Draw the target shape';
    case 'avoids-hazards':
      return 'Miss every rock and wall';
  }
}

/**
 * A route check reads as the page's NAME in the navigation bar, not its path.
 * '/history' is an implementation detail; "Open History" is the thing the
 * learner is being asked to click. Unknown paths fall back to the raw path so
 * a new check is merely ugly rather than silently mislabelled.
 */
const ROUTE_LABELS: Record<string, string> = {
  '/history': 'Open History',
  '/leaderboard': 'Open Leaderboard',
  '/mission': 'Open Create Mission',
};

/**
 * Blockly and Monaco challenges share these check patterns, so the wording has
 * to fit both - Level 2 drags a Repeat block, Level 3 types the loop out.
 */
const CODE_CONTAINS_LABELS: Record<string, string> = {
  'for _ in range(': 'Repeat the movement in a loop',
  'rover.setServo(0,': 'Point the mast',
  'take_photo()': 'Take a picture of the sample',
};

/** What an open code-contains check says is missing, in the same terms as its label. */
const CODE_CONTAINS_MISSING: Record<string, string> = {
  'for _ in range(': 'Your program does not use a loop yet.',
  'rover.setServo(0,': 'Your program does not point the mast yet.',
  'take_photo()': 'Your program does not take a picture of the sample yet.',
};

const OUTCOME_VERBS: Record<Extract<ChallengeCheckSpec, { kind: 'trajectory-outcome' }>['outcome'], string> = {
  'moved-forward': 'drive forward',
  'moved-backward': 'drive backward',
  'spun-left': 'spin left',
  'spun-right': 'spin right',
};

/**
 * What an open check is still waiting for, after a run (AB#448).
 *
 * Names what is MISSING, never how to supply it: what the run did ("stopped
 * before the target", "hit the wall") or what the program lacks ("does not
 * use a loop yet"), so a learner can find the fix themselves. Never "wrong"
 * or "failed" - a test's open check is work still to do, not a verdict.
 *
 * null for a check that passes, and before the first run: the open item in
 * the checklist already says what to do, and telling a learner who has not
 * pressed Run yet what their run did not do is just noise. Checks about the
 * site rather than a run (the Level 1 tour) have no run, and so say nothing
 * more than their label.
 */
export function explainOpenCheck(spec: ChallengeCheckSpec, context: ChallengeEvalContext, passed: boolean): string | null {
  if (passed || !context.runPath) return null;
  const crashed = context.runCrashInto
    ? `Your rover hit ${context.runCrashInto === 'wall' ? 'the wall' : 'a rock'}`
    : null;

  switch (spec.kind) {
    case 'trajectory-outcome':
      return `Your rover did not ${OUTCOME_VERBS[spec.outcome]} in that run.`;
    case 'code-contains':
      return CODE_CONTAINS_MISSING[spec.pattern] ?? 'Your program is missing a command this needs.';
    case 'avoids-hazards':
      return crashed ? `${crashed}.` : null;
    case 'reaches-target': {
      if (crashed) return `${crashed} before it reached the target.`;
      const goal = context.targetGoal;
      const end = context.runEnd;
      if (!goal || !end || !context.target) return null;
      return {
        short: 'Your rover stopped before the target.',
        past: 'Your rover went past the target.',
        elsewhere: 'Your rover went a different way and stopped away from the target.',
      }[missedGoal(end, context.target.path, goal.radiusCm)];
    }
    case 'matches-target': {
      const target = context.target;
      if (!target || target.matchWithinCm === null) return null;
      if (crashed) return `${crashed} before it finished the shape.`;
      return pathMismatch(context.runPath, target.path, target.matchWithinCm) === 'incomplete'
        ? 'Your rover drew part of the shape, then stopped before finishing it.'
        : 'Part of your run goes off the target shape.';
    }
    default:
      return null;
  }
}
