/**
 * Challenge Domain Entities
 *
 * Static shape of the Progressive Challenges track: levels, challenges and
 * their steps. Plain types only, no logic - mirrors Mission.ts's split
 * between "what a thing is" (here) and "where instances of it live"
 * (infrastructure/config/challenges.ts for content, FirestoreChallengeProgressRepository
 * for a learner's progress through it).
 */

export type ChallengeLevelId = 1 | 2 | 3;

export type ChallengeId =
  | 'platform-orientation'
  | 'basic-movement'
  | 'loop-structures'
  | 'sensor-operations';

/**
 * What one checklist item verifies, as plain data rather than a function.
 *
 * Keeps challenge content serializable and testable independently of the
 * React tree that evaluates it - ChallengeCheckEvaluator turns one of these
 * plus live app state into a pass/fail, but the spec itself has no behaviour.
 */
export type ChallengeCheckSpec =
  | {
      kind: 'search-query';
      /** Query must contain this (case-insensitive). Omit to accept any non-empty query. */
      matches?: string;
    }
  | { kind: 'search-filter'; filterKey: string }
  | { kind: 'load-more' }
  | { kind: 'blockly-block-present'; blockType: string; minCount?: number }
  | {
      kind: 'blockly-shape';
      /** Structural elements the workspace/generated code must contain together. */
      requires: Array<'distance-read' | 'comparison' | 'loop' | 'conditional'>;
    }
  | {
      kind: 'trajectory-outcome';
      outcome: 'moved-forward' | 'moved-backward' | 'spun-left' | 'spun-right';
    };

export interface ChallengeStep {
  id: string;
  title: string;
  instructions: string;
  hints?: string[];
  checks: ChallengeCheckSpec[];
}

export type ChallengeWorkspaceKind = 'embedded-platform' | 'blockly-sim';

export interface Challenge {
  id: ChallengeId;
  levelId: ChallengeLevelId;
  title: string;
  summary: string;
  workspaceKind: ChallengeWorkspaceKind;
  steps: ChallengeStep[];
}

export interface ChallengeLevel {
  id: ChallengeLevelId;
  title: string;
  description: string;
  challengeIds: ChallengeId[];
}
