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

  useEffect(() => {
    loadLeaderboard();
  }, []);

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
              See how you rank among other learners. Your real identity stays private—we&apos;ll give you a random nickname like &quot;Brave Rover.&quot;
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

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-4 pb-5">
        {/* Your Status Card - Compact horizontal layout */}
        {status && status.optedIn && (
          <div className="shrink-0 rounded-xl border border-border bg-card p-3 clay">
            <div className="flex items-center justify-between gap-4">
              <div className="flex gap-6 items-center">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Your Rank</p>
                  <p className="text-lg font-bold text-gradient-mars">
                    {learnerRank ? `#${learnerRank}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Challenges</p>
                  <p className="text-lg font-bold text-foreground">{status.completedChallenges}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Score</p>
                  <p className="text-lg font-bold text-primary">{status.score}</p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Nickname</p>
                  <p className="text-lg font-semibold text-foreground">{status.displayName}</p>
                </div>
              </div>

              <div className="flex gap-1 shrink-0">
                <button
                  onClick={regenerateNickname}
                  className="clay clay-press flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50"
                  title="Get a new nickname"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New</span>
                </button>
                <button
                  onClick={optOut}
                  className="clay clay-press flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
                  title="Hide from leaderboard"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Hide</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard Table - Takes most of the space */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
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
            <div className="overflow-hidden rounded-xl border border-border bg-card clay flex flex-col min-h-0">
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-xs sm:text-sm table-fixed">
                  <colgroup>
                    <col className="w-20 sm:w-24" />
                    <col className="flex-1" />
                    <col className="w-16 sm:w-20" />
                    <col className="w-16 sm:w-20" />
                  </colgroup>
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      <th className="text-left px-3 sm:px-4 py-2 font-semibold text-muted-foreground">Rank</th>
                      <th className="text-left px-3 sm:px-4 py-2 font-semibold text-muted-foreground">Name</th>
                      <th className="text-center px-3 sm:px-4 py-2 font-semibold text-muted-foreground text-xs sm:text-sm">
                        <span className="hidden sm:inline">Challenges</span>
                        <span className="sm:hidden">Challs</span>
                      </th>
                      <th className="text-right px-3 sm:px-4 py-2 font-semibold text-muted-foreground">Score</th>
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
                        <td className="px-3 sm:px-4 py-2 font-bold text-gradient-mars whitespace-nowrap">
                          {index === 0 && '🏆 '} {index === 1 && '🥈 '} {index === 2 && '🥉 '}
                          #{index + 1}
                        </td>
                        <td className="px-3 sm:px-4 py-2 font-semibold text-foreground truncate">
                          {entry.displayName}
                          {status?.optedIn && entry.displayName === status.displayName && (
                            <span className="ml-1 text-xs bg-gradient-mars text-primary-foreground px-1.5 py-0.5 rounded">
                              You
                            </span>
                          )}
                        </td>
                        <td className="px-3 sm:px-4 py-2 text-center text-foreground font-medium">
                          {entry.completedChallenges}
                        </td>
                        <td className="px-3 sm:px-4 py-2 text-right font-bold text-gradient-mars">
                          {entry.score}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
