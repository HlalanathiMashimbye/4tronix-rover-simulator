/**
 * Challenge Progress Domain Entity
 *
 * A learner's advancement through the Progressive Challenges track. Kept
 * minimal - which challenges are done, and which step a learner last reached
 * in each. Whether a LEVEL is unlocked is deliberately not stored here: it is
 * derived from the completions plus the level definitions, the same way
 * isActiveMission/isTerminalMission derive a mission's state next to Mission
 * rather than caching a redundant flag.
 */

import { ChallengeId, ChallengeLevel, ChallengeLevelId } from './Challenge';

export interface ChallengeCompletion {
  challengeId: ChallengeId;
  completedAt: string;
}

export interface ChallengeProgress {
  completions: ChallengeCompletion[];
  currentStepByChallenge?: Partial<Record<ChallengeId, number>>;
}

export function isChallengeComplete(challengeId: ChallengeId, progress: ChallengeProgress): boolean {
  return progress.completions.some((c) => c.challengeId === challengeId);
}

/**
 * A level is unlocked once every challenge in the PRECEDING level (by id
 * order) is complete. The first level in the list is always unlocked.
 *
 * Takes `levels` as a plain argument rather than importing the static
 * content config: core/ may not import infrastructure/ (see
 * __tests__/unit/architecture.test.ts), and the config lives there. Callers
 * outside core (the useChallengeProgress hook) supply CHALLENGE_LEVELS.
 */
export function isLevelUnlocked(
  levelId: ChallengeLevelId,
  levels: ChallengeLevel[],
  progress: ChallengeProgress,
): boolean {
  const ordered = [...levels].sort((a, b) => a.id - b.id);
  const index = ordered.findIndex((l) => l.id === levelId);
  if (index <= 0) return true;

  const previous = ordered[index - 1];
  return previous.challengeIds.every((id) => isChallengeComplete(id, progress));
}

/** Every challenge across every level that is not yet complete. */
export function remainingChallenges(levels: ChallengeLevel[], progress: ChallengeProgress): ChallengeId[] {
  return levels.flatMap((l) => l.challengeIds).filter((id) => !isChallengeComplete(id, progress));
}

/** How many challenges exist in total, for a "N/M complete" badge. */
export function totalChallengeCount(levels: ChallengeLevel[]): number {
  return levels.reduce((sum, l) => sum + l.challengeIds.length, 0);
}
