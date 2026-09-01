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

export type TrajectoryOutcome = 'moved-forward' | 'moved-backward' | 'spun-left' | 'spun-right';

export interface ChallengeEvalContext {
  search?: {
    query: string;
    activeFilter: string;
  };
  /** Whether "Show more missions" has been used at least once this session. */
  loadMoreCalled?: boolean;
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
      return context.loadMoreCalled === true;

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
