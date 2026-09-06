/**
 * Challenge Check Evaluator
 *
 * Turns one ChallengeCheckSpec (declarative content, see Challenge.ts) plus a
 * snapshot of whatever's live in the workspace into a pass/fail. A plain
 * switch, not a class per check kind - the codebase's own preference for
 * direct functions over speculative abstraction, and there are only a
 * handful of kinds across all three levels.
 *
 * Framework-agnostic on purpose: the workspace assembles a fresh
 * ChallengeEvalContext from React state each time something relevant
 * changes, and this function has no idea any of that exists.
 */

import { ChallengeCheckSpec } from '@/core/domain/entities/Challenge';
import type { SimulationCommand } from '@/lib/roverBlockly';

export type TrajectoryOutcome = 'moved-forward' | 'moved-backward' | 'spun-left' | 'spun-right';

export interface ChallengeEvalContext {
  search?: {
    query: string;
    activeFilter: string;
  };
  /** Whether "Show more missions" has been used at least once this session. */
  loadMoreCalled?: boolean;
  /**
   * Whether the feed has a further page to load, once that's known. False
   * means there is nothing more to browse - on a database with 24 or fewer
   * missions total, the "Show more missions" button never renders at all,
   * so 'load-more' checks treat that as already satisfied rather than an
   * impossible step. Undefined (not yet known, e.g. still loading) does NOT
   * count as false - the check still requires the real click once a further
   * page turns out to exist.
   */
  feedHasMore?: boolean;
  /** Outcomes the last simulated run actually produced. */
  trajectoryOutcomes?: TrajectoryOutcome[];
  /** The current Blockly editor's generated Python, for code-contains checks. */
  generatedCode?: string;
}

export function evaluateCheck(spec: ChallengeCheckSpec, context: ChallengeEvalContext): boolean {
  switch (spec.kind) {
    case 'search-query': {
      const query = context.search?.query.trim().toLowerCase() ?? '';
      if (!query) return false;
      return spec.matches ? query.includes(spec.matches.toLowerCase()) : true;
    }

    case 'search-filter':
      return context.search?.activeFilter === spec.filterKey;

    case 'load-more':
      return context.loadMoreCalled === true || context.feedHasMore === false;

    case 'trajectory-outcome':
      return context.trajectoryOutcomes?.includes(spec.outcome) ?? false;

    case 'code-contains':
      return context.generatedCode?.includes(spec.pattern) ?? false;

    default:
      // Exhaustiveness check: a new ChallengeCheckKind added to the domain
      // type without a case here is a compile error, not a silent false.
      return ((_exhaustive: never) => false)(spec);
  }
}

/** Every check in a step passes. */
export function stepChecksPass(checks: ChallengeCheckSpec[], context: ChallengeEvalContext): boolean {
  return checks.every((check) => evaluateCheck(check, context));
}

/**
 * What a simulated run actually did, read off the command list itself.
 *
 * Lives here rather than in the workspace component that calls it because it
 * is the other half of a 'trajectory-outcome' check: this decides what counts
 * as "the rover moved forward", evaluateCheck only asks whether it happened.
 * Splitting those across a React component and a service meant the mapping
 * could not be tested without rendering an editor, and the two halves of one
 * rule could drift without anything noticing.
 *
 * Commands, not trajectory points: a zero-duration or immediately-stopped
 * move still counts as having been commanded, which is what a challenge step
 * is asking the learner to demonstrate.
 */
export function deriveTrajectoryOutcomes(commands: SimulationCommand[]): TrajectoryOutcome[] {
  const outcomes = new Set<TrajectoryOutcome>();
  for (const command of commands) {
    if (command.command === 'forward') outcomes.add('moved-forward');
    if (command.command === 'reverse') outcomes.add('moved-backward');
    if (command.command === 'spinLeft') outcomes.add('spun-left');
    if (command.command === 'spinRight') outcomes.add('spun-right');
  }
  return [...outcomes];
}
