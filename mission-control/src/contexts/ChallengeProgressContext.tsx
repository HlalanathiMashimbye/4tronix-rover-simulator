'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';
import { challengeProgressService } from '@/infrastructure/container.browser';
import { CHALLENGE_LEVELS } from '@/infrastructure/config/challenges';
import type { ChallengeId, ChallengeLevelId } from '@/core/domain/entities/Challenge';
import type { ChallengeProgress } from '@/core/domain/entities/ChallengeProgress';

const EMPTY_PROGRESS: ChallengeProgress = { completions: [] };

interface ChallengeProgressContextType {
  progress: ChallengeProgress;
  loading: boolean;
  completeChallenge: (challengeId: ChallengeId) => Promise<ChallengeLevelId | null>;
  saveCurrentStep: (challengeId: ChallengeId, stepIndex: number) => Promise<void>;
}

const ChallengeProgressContext = createContext<ChallengeProgressContextType | undefined>(undefined);

export function ChallengeProgressProvider({ children }: { children: ReactNode }) {
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

  const saveCurrentStep = useCallback(async (challengeId: ChallengeId, stepIndex: number) => {
    const learnerId = getLearnerID();
    await challengeProgressService().saveCurrentStep(learnerId, challengeId, stepIndex);
    setProgress((prev) => ({
      ...prev,
      currentStepByChallenge: { ...prev.currentStepByChallenge, [challengeId]: stepIndex },
    }));
  }, []);

  const completeChallenge = useCallback(async (challengeId: ChallengeId): Promise<ChallengeLevelId | null> => {
    const learnerId = getLearnerID();
    const result = await challengeProgressService().completeChallenge(
      learnerId,
      challengeId,
      CHALLENGE_LEVELS,
    );
    setProgress(result.progress);

    try {
      await fetch(`/api/leaderboard/challenges/${challengeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnerId }),
      });
    } catch (error) {
      console.warn('Failed to record challenge completion on leaderboard:', error);
    }

    return result.justUnlockedLevelId;
  }, []);

  return (
    <ChallengeProgressContext.Provider value={{ progress, loading, completeChallenge, saveCurrentStep }}>
      {children}
    </ChallengeProgressContext.Provider>
  );
}

export function useChallengeProgressContext() {
  const context = useContext(ChallengeProgressContext);
  if (context === undefined) {
    throw new Error('useChallengeProgressContext must be used within a ChallengeProgressProvider');
  }
  return context;
}
