/**
 * Challenge Domain Entities
 *
 * Static shape of the Progressive Challenges track: levels, challenges and
 * their steps. Plain types only, no logic - mirrors Mission.ts's split
 * between "what a thing is" (here) and "where instances of it live"
 * (infrastructure/config/challenges.ts for content, FirestoreChallengeProgressRepository
 * for a learner's progress through it).
 */

import type { SimulationCommand } from '@/lib/roverBlockly';

export type ChallengeLevelId = 1 | 2 | 3;

export type ChallengeId =
  | 'platform-orientation'
  | 'explore-the-platform'
  | 'first-mission'
  | 'drive-to-target'
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
      /**
       * The learner has opened this page at some point, e.g. '/history'.
       *
       * Unlike every other kind here, what this checks happened on a DIFFERENT
       * page - the challenge workspace was not even mounted at the time. See
       * infrastructure/browser/platformMilestones.ts for where the evidence
       * survives the navigation.
       */
      kind: 'route-visited';
      path: string;
    }
  | {
      /** The learner has successfully sent a mission to the queue. */
      kind: 'mission-created';
    }
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
    }
  | {
      /**
       * The learner has picked an answer to the step's prediction. Any answer
       * passes: in PRIMM the guess is never marked wrong (AB#453) - it is
       * there so the run that follows has something to be compared with.
       */
      kind: 'prediction-made';
    }
  | {
      /**
       * The last simulated run ended on the challenge's target - within its
       * arriveWithinCm of where the target's reference program stops.
       */
      kind: 'reaches-target';
    };

export interface ChallengeStep {
  id: string;
  title: string;
  instructions: string;
  hints?: string[];
  checks: ChallengeCheckSpec[];
  /**
   * The Predict in PRIMM: a question about the code already on the canvas,
   * answered by picking one option before anything has been run.
   */
  prediction?: {
    question: string;
    options: string[];
  };
}

/**
 * What a finished challenge should look like, shown on the simulator (AB#447)
 * so a learner knows what they are aiming for.
 *
 * Held as a REFERENCE PROGRAM rather than a drawn shape: the simulator runs it
 * through the same physics as the learner's own code, so the target's corners
 * and distances are exactly what a correct program produces rather than an
 * idealised drawing a correct program could never match. Only the path is
 * ever drawn - never these commands, nor the blocks or code that make them.
 */
export interface ChallengeTarget {
  /** One line, about the result and never the steps, e.g. "four sides, 90 degree corners". */
  description: string;
  commands: SimulationCommand[];
  /**
   * Set when the target is a place to reach: the end of the path is drawn as
   * a marker, and a 'reaches-target' check passes within this many cm of it.
   */
  arriveWithinCm?: number;
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
  scorePoints: number;
  steps: ChallengeStep[];
  /** Ids of the LearningOutcomes, on this challenge's own level, that it practises. */
  outcomeIds: string[];
  target?: ChallengeTarget;
  /**
   * Ready-made code on the Blockly canvas when the challenge first opens, as
   * Blockly's own serialization JSON - for a PRIMM challenge, which starts by
   * reading code rather than writing it. Omitted, the canvas starts with the
   * uplink block alone.
   */
  starterBlocks?: object;
}

/** One CSTA K-12 Computer Science Standard, worded as CSTA publishes it. */
export interface CstaStandard {
  code: string;
  /** e.g. 'Grades 3-5' - shown so a teacher can see the band a claim is pitched at. */
  gradeBand: string;
  text: string;
}

/**
 * Where a learning outcome comes from. CSTA and NASA JPL are the primary
 * sources (AB#444); CAPS is a secondary reference, cited only where it fits.
 * At least one of csta / nasaJpl must be present - see curriculumOutcomes.ts.
 */
export interface LearningOutcomeAlignment {
  /** Codes into the CSTA catalogue (infrastructure/config/curriculumStandards.ts). */
  csta?: string[];
  /** The NASA JPL mission work this outcome mirrors, in a sentence a parent can read. */
  nasaJpl?: string;
  caps?: string;
}

/** One thing a learner will be able to do by the end of a level. */
export interface LearningOutcome {
  id: string;
  /** Always phrased "You will be able to ...", addressed to the learner. */
  text: string;
  alignment: LearningOutcomeAlignment;
}

export interface ChallengeLevel {
  id: ChallengeLevelId;
  title: string;
  description: string;
  challengeIds: ChallengeId[];
  outcomes: LearningOutcome[];
}
