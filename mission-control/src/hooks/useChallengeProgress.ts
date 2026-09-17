'use client';

/**
 * Component-facing view of a learner's Progressive Challenges progress.
 *
 * State lives in ChallengeProgressContext (loaded once from Firestore,
 * shared across the tree). This hook adds the derived convenience values
 * that components need — level unlock checks, completion checks, counts —
 * so consumers keep the same API they had before the context existed.
 */

import { useCallback } from 'react';
import { CHALLENGE_LEVELS } from '@/infrastructure/config/challenges';
import type { ChallengeId, ChallengeLevelId } from '@/core/domain/entities/Challenge';
import {
  isChallengeComplete,
  isLevelUnlocked,
  totalChallengeCount,
} from '@/core/domain/entities/ChallengeProgress';
import { useChallengeProgressContext } from '@/contexts/ChallengeProgressContext';

export function useChallengeProgress() {
  const { progress, loading, completeChallenge, saveCurrentStep } = useChallengeProgressContext();

  const isLevelUnlockedFn = useCallback(
    (levelId: ChallengeLevelId) => isLevelUnlocked(levelId, CHALLENGE_LEVELS, progress),
    [progress],
  );

  const isChallengeCompleteFn = useCallback(
    (challengeId: ChallengeId) => isChallengeComplete(challengeId, progress),
    [progress],
  );

  const isChallengeStartedFn = useCallback(
    (challengeId: ChallengeId) => progress.currentStepByChallenge?.[challengeId] !== undefined,
    [progress],
  );

  return {
    progress,
    loading,
    isLevelUnlocked: isLevelUnlockedFn,
    isChallengeComplete: isChallengeCompleteFn,
    isChallengeStarted: isChallengeStartedFn,
    completeChallenge,
    saveCurrentStep,
    completedCount: progress.completions.length,
    totalCount: totalChallengeCount(CHALLENGE_LEVELS),
  };
}
