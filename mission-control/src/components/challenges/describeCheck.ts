import type { ChallengeCheckSpec } from '@/core/domain/entities/Challenge';

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
};
