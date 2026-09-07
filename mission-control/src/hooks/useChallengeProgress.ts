'use client';

/**
 * Component-facing view of a learner's Progressive Challenges progress.
 *
 * Shaped like useFavorites.ts (load once, expose flat helpers), but backed by
 * Firestore rather than localStorage since progress must follow a learner
 * across devices the same way their mission history does. The composition
 * root call (challengeProgressService()) happens only here - Navbar, the hub
 * page and the challenge workspace all consume this hook rather than
 * constructing a repository or service themselves.
 */

import { useCallback, useEffect, useState } from 'react';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';
import { challengeProgressService } from '@/infrastructure/container.browser';
import { CHALLENGE_LEVELS } from '@/infrastructure/config/challenges';
import { ChallengeId, ChallengeLevelId } from '@/core/domain/entities/Challenge';
import {
  ChallengeProgress,
  isChallengeComplete,
  isLevelUnlocked,
  totalChallengeCount,
} from '@/core/domain/entities/ChallengeProgress';

const EMPTY_PROGRESS: ChallengeProgress = { completions: [] };

export function useChallengeProgress() {
  const [progress, setProgress] = useState<ChallengeProgress>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    challengeProgressService()
      .getProgress(getLearnerID())
      .then((loaded) => {
        if (!cancelled) setProgress(loaded);
      })
      .catch((error) => {
        console.warn('Failed to load challenge progress:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isLevelUnlockedFn = useCallback(
    (levelId: ChallengeLevelId) => isLevelUnlocked(levelId, CHALLENGE_LEVELS, progress),
    [progress],
  );

  const isChallengeCompleteFn = useCallback(
    (challengeId: ChallengeId) => isChallengeComplete(challengeId, progress),
    [progress],
  );

  /** Returns the level id that just unlocked, if this completion caused one to. */
  const completeChallenge = useCallback(async (challengeId: ChallengeId): Promise<ChallengeLevelId | null> => {
    const learnerId = getLearnerID();
    const result = await challengeProgressService().completeChallenge(
      learnerId,
      challengeId,
      CHALLENGE_LEVELS,
    );
    setProgress(result.progress);

    // Record the challenge completion on the leaderboard (idempotent)
    try {
      await fetch(`/api/leaderboard/challenges/${challengeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnerId }),
      });
    } catch (error) {
      console.warn('Failed to record challenge completion on leaderboard:', error);
      // Non-fatal: challenges tab works even if leaderboard update fails
    }

    return result.justUnlockedLevelId;
  }, []);

  return {
    progress,
    loading,
    isLevelUnlocked: isLevelUnlockedFn,
    isChallengeComplete: isChallengeCompleteFn,
    completeChallenge,
    completedCount: progress.completions.length,
    totalCount: totalChallengeCount(CHALLENGE_LEVELS),
  };
}
