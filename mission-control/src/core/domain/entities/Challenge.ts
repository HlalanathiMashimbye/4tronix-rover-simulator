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
  | 'draw-a-square';

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
  | {
      kind: 'trajectory-outcome';
      outcome: 'moved-forward' | 'moved-backward' | 'spun-left' | 'spun-right';
    }
  | {
      /**
       * The generated Python contains this substring. Structural validation
       * over the code rather than the raw workspace: the Blockly toolbox has
       * no comparison/conditional blocks and the sensor/mast blocks (unlike
       * movement ones) produce no simulated trajectory at all, so text is the
       * one signal common to every block this can check for - e.g.
       * `for _ in range(` for a Repeat block. See lib/roverBlockly.ts's
       * workspaceToPython, and lib/parseRoverCode.ts for the Monaco side.
       */
      kind: 'code-contains';
      pattern: string;
    };

export interface ChallengeStep {
  id: string;
  title: string;
  instructions: string;
  hints?: string[];
  checks: ChallengeCheckSpec[];
}

/**
 * 'blockly-sim': the Blockly visual canvas + rover simulator (Level 2).
 * 'monaco-sim': the Monaco Python text editor + rover simulator (Level 3) -
 * the same shapes Level 2 builds from blocks, written out by hand, so a
 * learner crosses from blocks to text on a task whose outcome they already
 * recognise rather than on new material.
 */
export type ChallengeWorkspaceKind = 'embedded-platform' | 'blockly-sim' | 'monaco-sim';

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
