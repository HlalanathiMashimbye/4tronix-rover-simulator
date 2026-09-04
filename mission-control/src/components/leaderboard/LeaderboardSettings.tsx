'use client';

import { useState } from 'react';
import { Trophy, RotateCcw, LogOut, LogIn } from 'lucide-react';
import { useLeaderboard } from '@/hooks/useLeaderboard';

export function LeaderboardSettings() {
  const { status, loading, error, optIn, optOut, regenerateNickname } = useLeaderboard();
  const [isChanging, setIsChanging] = useState(false);

  const handleOptIn = async () => {
    setIsChanging(true);
    try {
      await optIn();
    } finally {
      setIsChanging(false);
    }
  };

  const handleOptOut = async () => {
    setIsChanging(true);
    try {
      await optOut();
    } finally {
      setIsChanging(false);
    }
  };

  const handleRegenerate = async () => {
    setIsChanging(true);
    try {
      await regenerateNickname();
    } finally {
      setIsChanging(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 clay">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-gradient-mars" />
          <h3 className="font-display font-bold text-foreground">Leaderboard</h3>
        </div>
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 clay">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="h-5 w-5 text-destructive" />
          <h3 className="font-display font-bold text-destructive">Leaderboard</h3>
        </div>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 clay">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-5 w-5 text-gradient-mars" />
        <h3 className="font-display font-bold text-foreground">Leaderboard</h3>
      </div>

      {status.optedIn ? (
        <>
          <div className="mb-4 space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Your nickname
              </p>
              <p className="font-semibold text-foreground text-lg">{status.displayName}</p>
            </div>

            {status.rank && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Your rank
                </p>
                <p className="font-bold text-gradient-mars text-lg">#{status.rank}</p>
              </div>
            )}

            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Score
              </p>
              <p className="font-semibold text-primary text-lg">{status.score}</p>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={handleRegenerate}
              disabled={isChanging}
              className="clay clay-press w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 font-semibold text-foreground disabled:opacity-60 transition"
            >
              <RotateCcw className="h-4 w-4" />
              Get a new nickname
            </button>
            <button
              onClick={handleOptOut}
              disabled={isChanging}
              className="clay clay-press w-full flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 font-semibold text-destructive disabled:opacity-60 transition"
            >
              <LogOut className="h-4 w-4" />
              Hide from leaderboard
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            You&apos;re not on the leaderboard yet. Join to see how you rank!
          </p>
          <button
            onClick={handleOptIn}
            disabled={isChanging}
            className="clay clay-press w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-mars px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-60 transition"
          >
            <LogIn className="h-4 w-4" />
            Join the leaderboard
          </button>
        </>
      )}
    </div>
  );
}
