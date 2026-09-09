/**
 * Hook for managing learner's leaderboard preferences
 *
 * Handles:
 * - Opt-in/opt-out
 * - Nickname regeneration
 * - Loading current status
 */

import { useState, useCallback, useEffect } from 'react';
import { hashLearnerId } from '@/core/domain/services/learnerRef';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';

export interface LeaderboardStatus {
  optedIn: boolean;
  displayName: string;
  score: number;
  completedChallenges: number;
  rank?: number | null;
}

export function useLeaderboard() {
  const [status, setStatus] = useState<LeaderboardStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const learnerId = getLearnerID();
      const learnerRefHash = await hashLearnerId(learnerId);

      const response = await fetch(
        `/api/learners/${encodeURIComponent(learnerRefHash)}/leaderboard`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load leaderboard status');
      }

      const data = await response.json();
      setStatus(data as LeaderboardStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const optIn = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const learnerId = getLearnerID();
      const learnerRefHash = await hashLearnerId(learnerId);

      const response = await fetch(
        `/api/learners/${encodeURIComponent(learnerRefHash)}/leaderboard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'opt-in' }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to opt in');
      }

      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  const optOut = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const learnerId = getLearnerID();
      const learnerRefHash = await hashLearnerId(learnerId);

      const response = await fetch(
        `/api/learners/${encodeURIComponent(learnerRefHash)}/leaderboard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'opt-out' }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to opt out');
      }

      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  const regenerateNickname = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const learnerId = getLearnerID();
      const learnerRefHash = await hashLearnerId(learnerId);

      const response = await fetch(
        `/api/learners/${encodeURIComponent(learnerRefHash)}/leaderboard`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'regenerate-nickname' }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to regenerate nickname');
      }

      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return {
    status,
    loading,
    error,
    optIn,
    optOut,
    regenerateNickname,
    refresh: loadStatus,
  };
}
