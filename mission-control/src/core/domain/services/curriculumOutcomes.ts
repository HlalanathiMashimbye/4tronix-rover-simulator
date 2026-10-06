/**
 * The rules a level's learning outcomes must satisfy (AB#444).
 *
 * Content lives in infrastructure/config/challenges.ts and is hand-authored,
 * so nothing at the type level stops a new challenge shipping without an
 * outcome, a level promising five things, or an outcome citing a standard
 * nobody wrote down. This is the one place those rules live; the unit test
 * runs it against the real content, which turns "every challenge maps to an
 * outcome" into a failing build rather than a review comment.
 */

import type {
  Challenge,
  ChallengeId,
  ChallengeLevel,
  CstaStandard,
} from '@/core/domain/entities/Challenge';

export const OUTCOME_PREFIX = 'You will be able to ';
export const MIN_OUTCOMES_PER_LEVEL = 2;
export const MAX_OUTCOMES_PER_LEVEL = 4;

/** The challenge a learner meets a level through - where its outcomes are briefed. */
export function isFirstChallengeOfLevel(level: ChallengeLevel, challengeId: ChallengeId): boolean {
  return level.challengeIds[0] === challengeId;
}

/** The challenges on a level that practise the given outcome, in level order. */
export function challengesPractising<C extends Pick<Challenge, 'id' | 'outcomeIds'>>(
  level: ChallengeLevel,
  outcomeId: string,
  challenges: Record<ChallengeId, C>,
): C[] {
  return level.challengeIds
    .map((id) => challenges[id])
    .filter((c): c is C => Boolean(c) && c.outcomeIds.includes(outcomeId));
}

/** Every rule violation in the given content, as human-readable lines. Empty means valid. */
export function findCurriculumProblems(
  levels: ChallengeLevel[],
  challenges: Record<ChallengeId, Challenge>,
  cstaCatalogue: Record<string, CstaStandard>,
): string[] {
  const problems: string[] = [];
  const seenOutcomeIds = new Set<string>();

  for (const level of levels) {
    const count = level.outcomes.length;
    if (count < MIN_OUTCOMES_PER_LEVEL || count > MAX_OUTCOMES_PER_LEVEL) {
      problems.push(
        `Level ${level.id} has ${count} outcomes; it needs ${MIN_OUTCOMES_PER_LEVEL} to ${MAX_OUTCOMES_PER_LEVEL}.`,
      );
    }

    for (const outcome of level.outcomes) {
      if (seenOutcomeIds.has(outcome.id)) {
        problems.push(`Outcome id "${outcome.id}" is used more than once.`);
      }
      seenOutcomeIds.add(outcome.id);

      if (!outcome.text.startsWith(OUTCOME_PREFIX)) {
        problems.push(`Outcome "${outcome.id}" does not start with "${OUTCOME_PREFIX.trim()}".`);
      }

      // CAPS alone does not count: the story makes it a secondary reference.
      const { csta = [], nasaJpl } = outcome.alignment;
      if (csta.length === 0 && !nasaJpl?.trim()) {
        problems.push(`Outcome "${outcome.id}" is not mapped to a CSTA standard or a NASA JPL challenge.`);
      }
      for (const code of csta) {
        if (!cstaCatalogue[code]) {
          problems.push(`Outcome "${outcome.id}" cites CSTA ${code}, which is not in the standards catalogue.`);
        }
      }

      if (challengesPractising(level, outcome.id, challenges).length === 0) {
        problems.push(`Outcome "${outcome.id}" on Level ${level.id} is not practised by any of its challenges.`);
      }
    }

    const levelOutcomeIds = new Set(level.outcomes.map((o) => o.id));
    for (const challengeId of level.challengeIds) {
      const challenge = challenges[challengeId];
      if (!challenge) continue;

      if (challenge.outcomeIds.length === 0) {
        problems.push(`Challenge "${challengeId}" is not mapped to any outcome.`);
      }
      for (const outcomeId of challenge.outcomeIds) {
        if (!levelOutcomeIds.has(outcomeId)) {
          problems.push(
            `Challenge "${challengeId}" maps to "${outcomeId}", which is not an outcome of Level ${level.id}.`,
          );
        }
      }
    }
  }

  return problems;
}
