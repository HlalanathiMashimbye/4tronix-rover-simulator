/**
 * Challenge Progress Service
 *
 * Thin orchestration over IChallengeProgressRepository, same role as
 * MissionService: coordinate the repository call and report what changed.
 *
 * The unlock RULE itself (isLevelUnlocked) is a pure domain function next to
 * ChallengeProgress, not duplicated here - this service's only job is
 * detecting the moment a challenge's completion causes the NEXT level to
 * cross from locked to unlocked, so the caller can trigger the unlock
 * animation without re-deriving it itself.
 *
 * Follows Single Responsibility Principle (SOLID), matching MissionService.
 */

import { ChallengeId, ChallengeLevel, ChallengeLevelId } from '@/core/domain/entities/Challenge';
import {
  ChallengeProgress,
  isChallengeComplete,
  isLevelUnlocked,
} from '@/core/domain/entities/ChallengeProgress';
import { IChallengeProgressRepository } from '@/core/domain/repositories/IChallengeProgressRepository';

export interface CompleteChallengeResult {
  progress: ChallengeProgress;
  /** The level that transitioned from locked to unlocked by this completion, if any. */
  justUnlockedLevelId: ChallengeLevelId | null;
}

export class ChallengeProgressService {
  constructor(private readonly repository: IChallengeProgressRepository) {}

  async getProgress(learnerId: string): Promise<ChallengeProgress> {
    return this.repository.getProgress(learnerId);
  }

  /**
   * Mark a challenge complete and report whether that just unlocked a level.
   *
   * `levels` is supplied by the caller rather than imported here - the
   * content config lives in infrastructure/, which core/ may not import (see
   * __tests__/unit/architecture.test.ts).
   */
  async completeChallenge(
    learnerId: string,
    challengeId: ChallengeId,
    levels: ChallengeLevel[],
  ): Promise<CompleteChallengeResult> {
    const before = await this.repository.getProgress(learnerId);

    if (isChallengeComplete(challengeId, before)) {
      return { progress: before, justUnlockedLevelId: null };
    }

    await this.repository.markChallengeComplete(learnerId, challengeId, new Date().toISOString());
    const after = await this.repository.getProgress(learnerId);

    const justUnlocked = levels.find(
      (level) => !isLevelUnlocked(level.id, levels, before) && isLevelUnlocked(level.id, levels, after),
    );

    return { progress: after, justUnlockedLevelId: justUnlocked?.id ?? null };
  }
}
