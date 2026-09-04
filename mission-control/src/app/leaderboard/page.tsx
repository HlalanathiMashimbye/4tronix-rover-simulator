'use client';

import { useEffect, useState, useMemo } from 'react';
import { Trophy, RotateCcw, LogOut, LogIn } from 'lucide-react';
import { useLeaderboard } from '@/hooks/useLeaderboard';

interface LeaderboardEntry {
  displayName: string;
  score: number;
  completedChallenges: number;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, optIn, optOut, regenerateNickname } = useLeaderboard();

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/leaderboard');
      if (!response.ok) {
        throw new Error('Failed to load leaderboard');
      }

      const data = await response.json();
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const learnerRank = useMemo(() => {
    if (!status?.optedIn) return null;
    return entries.findIndex((e) => e.displayName === status.displayName) + 1;
  }, [entries, status]);

  // Show opt-in prompt if not opted in
  if (status && !status.optedIn) {
    return (
      <main className="relative flex h-[calc(100dvh-var(--app-chrome))] flex-col overflow-hidden px-4 sm:px-6">
        <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6 text-gradient-mars" />
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              Leaderboard
            </h1>
          </div>
        </header>

        <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col items-center justify-center pb-5">
          <div className="rounded-3xl border border-border bg-card p-8 clay max-w-md text-center">
            <Trophy className="h-16 w-16 text-gradient-mars mx-auto mb-4" />
            <h2 className="font-display text-2xl font-bold text-foreground mb-2">Join the Leaderboard</h2>
            <p className="text-sm text-muted-foreground mb-6">
              See how you rank among other learners. Your real identity stays private—we'll give you a random nickname like "Brave Rover."
            </p>

            <div className="space-y-2">
              <button
                onClick={optIn}
                className="clay clay-press w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-mars px-4 py-2.5 font-display font-semibold text-primary-foreground"
              >
                <LogIn className="h-4 w-4" />
                Join the leaderboard
              </button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              You can leave anytime without affecting your progress.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex h-[calc(100dvh-var(--app-chrome))] flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-gradient-mars" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Leaderboard
          </h1>
        </div>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
          Top learners ranked by completed challenges.
        </p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-6 pb-5 overflow-y-auto">
        {/* Your Status Card - Only show if opted in */}
        {status && status.optedIn && (
          <div className="rounded-2xl border border-border bg-card p-6 clay">
            <h2 className="font-display font-bold text-foreground mb-4">Your Progress</h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Challenges Completed</p>
                <p className="text-3xl font-bold text-gradient-mars">
                  {status.completedChallenges}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Score</p>
                <p className="text-3xl font-bold text-primary">{status.score}</p>
              </div>
            </div>

            {learnerRank && (
              <div className="mb-4">
                <p className="text-sm text-muted-foreground">Rank</p>
                <p className="text-2xl font-bold text-gradient-mars">#{learnerRank}</p>
                <p className="text-sm text-foreground mt-1">
                  You're {status.displayName} on the leaderboard
                </p>
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={regenerateNickname}
                className="clay clay-press w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 font-display font-semibold text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                Get a new nickname
              </button>
              <button
                onClick={optOut}
                className="clay clay-press w-full flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 font-display font-semibold text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Hide from leaderboard
              </button>
            </div>
          </div>
        )}

        {/* Leaderboard Table */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <h2 className="font-display font-bold text-foreground mb-3">Top Learners</h2>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-destructive/40 bg-destructive/10 p-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="font-display font-bold text-foreground">No one on the leaderboard yet</p>
                <p className="text-sm text-muted-foreground mt-1">Be the first to join!</p>
              </div>
            </div>
          ) : (
            <div className="overflow-y-auto rounded-2xl border border-border bg-card clay">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50">
                  <tr>
                    <th className="text-left px-6 py-3 font-semibold text-muted-foreground">Rank</th>
                    <th className="text-left px-6 py-3 font-semibold text-muted-foreground">Name</th>
                    <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Challenges</th>
                    <th className="text-right px-6 py-3 font-semibold text-muted-foreground">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <tr
                      key={index}
                      className={`border-t border-border hover:bg-muted/30 transition-colors ${
                        status?.optedIn && entry.displayName === status.displayName
                          ? 'bg-gradient-mars/10'
                          : ''
                      }`}
                    >
                      <td className="px-6 py-4 font-bold text-gradient-mars">
                        {index === 0 && '🏆'} {index === 1 && '🥈'} {index === 2 && '🥉'}{' '}
                        #{index + 1}
                      </td>
                      <td className="px-6 py-4 font-semibold text-foreground">
                        {entry.displayName}
                        {status?.optedIn && entry.displayName === status.displayName && (
                          <span className="ml-2 text-xs bg-gradient-mars text-primary-foreground px-2 py-1 rounded">
                            You
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right text-foreground">
                        {entry.completedChallenges}
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-gradient-mars">
                        {entry.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
