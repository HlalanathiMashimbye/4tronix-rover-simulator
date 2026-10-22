'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Trophy, LogIn, Pencil, Star, EyeOff, CircleCheck } from 'lucide-react';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useLearner } from '@/contexts/LearnerContext';
import { Avatar } from '@/components/learner/Avatar';
import { AvatarPicker } from '@/components/learner/AvatarPicker';
import { SaveProfileModal } from '@/components/learner/SaveProfileModal';
import { RestoreProfileModal } from '@/components/learner/RestoreProfileModal';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';
import type { LearnerAvatar } from '@/core/domain/entities/Learner';

interface LeaderboardEntry {
  displayName: string;
  score: number;
  completedChallenges: number;
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const { status, optIn, optOut, refresh } = useLeaderboard();
  const { learner, updateProfile, profileSaved } = useLearner();

  const handleProfileUpdate = useCallback(
    async (avatar: LearnerAvatar, displayName: string) => {
      const ok = await updateProfile(displayName, avatar);
      if (ok) {
        setShowPicker(false);
        await refresh();
      }
    },
    [updateProfile, refresh],
  );

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
      <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
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
            {learner?.avatar ? (
              <div className="mx-auto mb-4">
                <Avatar avatar={learner.avatar} size={80} />
              </div>
            ) : (
              <Trophy className="h-16 w-16 text-gradient-mars mx-auto mb-4" />
            )}
            <h2 className="font-display text-2xl font-bold text-foreground mb-2">Join the Leaderboard</h2>
            {learner?.displayName ? (
              <p className="text-sm text-muted-foreground mb-6">
                You&apos;ll appear as <span className="font-semibold text-foreground">{learner.displayName}</span> on the leaderboard. See how you rank among other learners!
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mb-6">
                See how you rank among other learners. Your real identity stays private.
              </p>
            )}

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
    <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
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

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-4 overflow-y-auto pb-5">
        {/* Your Status Card */}
        {status && status.optedIn && (
          <>
            {/* Desktop: single unified card */}
            <div className="hidden md:block shrink-0">
              <div className="rounded-2xl border border-border bg-card p-4 clay">
                <div className="flex items-center gap-6">
                  <Avatar avatar={learner?.avatar} size={48} />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{status.displayName}</p>
                  </div>

                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Your Rank</p>
                    <p className="text-2xl font-bold text-gradient-mars">
                      {learnerRank ? `#${learnerRank}` : '—'}
                    </p>
                  </div>

                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Challenges</p>
                    <p className="text-2xl font-bold text-foreground">{status.completedChallenges}</p>
                  </div>

                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Score</p>
                    <p className="text-2xl font-bold text-foreground">{status.score}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowPicker(true)}
                      className="clay clay-press flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-foreground hover:bg-muted/50"
                      title="Change avatar and nickname"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={optOut}
                      className="clay clay-press flex h-9 w-9 items-center justify-center rounded-xl border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                      title="Hide from leaderboard"
                    >
                      <EyeOff className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile: multi-card layout */}
            <div className="md:hidden shrink-0 space-y-3">
              <div className="rounded-2xl border border-border bg-card p-4 clay">
                <div className="flex items-center gap-4">
                  <Avatar avatar={learner?.avatar} size={48} />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Your Rank</p>
                    <p className="text-2xl font-bold text-gradient-mars">
                      {learnerRank ? `#${learnerRank}` : '—'}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground truncate">{status.displayName}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowPicker(true)}
                  className="clay clay-press flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50"
                  title="Change avatar and nickname"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
                <button
                  onClick={optOut}
                  className="clay clay-press flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/20"
                  title="Hide from leaderboard"
                >
                  <EyeOff className="h-4 w-4" />
                  Hide
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border bg-card p-4 clay">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-mars/15">
                    <Trophy className="h-5 w-5" style={{ color: 'var(--mars)' }} />
                  </div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Challenges</p>
                  <p className="text-2xl font-bold text-foreground">{status.completedChallenges}</p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-4 clay">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Star className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Score</p>
                  <p className="text-2xl font-bold text-foreground">{status.score}</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Profile save status card */}
        {status && status.optedIn && !profileSaved && (
          <div
            className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-[20px] border border-border/60 bg-muted px-5 py-4"
          >
            <div>
              <p className="font-semibold text-foreground">Your profile isn&apos;t saved yet</p>
              <p className="text-sm text-muted-foreground">Save it so you never lose your missions.</p>
            </div>
            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onClick={() => setShowSaveModal(true)}
                className="flex h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
              >
                Save my profile
              </button>
              <button
                type="button"
                onClick={() => setShowRestoreModal(true)}
                className="flex h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
              >
                Restore a profile
              </button>
            </div>
          </div>
        )}

        {status && status.optedIn && profileSaved && (
          <div className="shrink-0 flex items-center justify-between gap-4 py-1">
            <div className="flex items-center gap-2 text-sm">
              <CircleCheck className="h-5 w-5 text-green-600" />
              <span className="text-muted-foreground">Profile saved</span>
            </div>
            <button
              type="button"
              onClick={() => setShowRestoreModal(true)}
              className="text-sm text-muted-foreground underline transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 rounded"
            >
              Restore a different profile
            </button>
          </div>
        )}

        {/* Avatar / nickname picker modal */}
        {showPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 clay">
              <AvatarPicker
                learnerId={getLearnerID()}
                initialAvatar={learner?.avatar}
                initialName={learner?.displayName}
                onConfirm={handleProfileUpdate}
                confirmLabel="Save"
              />
              <button
                type="button"
                onClick={() => setShowPicker(false)}
                className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Leaderboard Table */}
        <div>
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
            <div className="overflow-hidden rounded-xl border border-border bg-card clay">
              <div>
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
                        <td className="px-3 sm:px-4 py-2 font-semibold text-foreground">
                          <div className="flex items-center gap-2 min-w-0">
                            {status?.optedIn && entry.displayName === status.displayName && (
                              <Avatar avatar={learner?.avatar} size={24} className="shrink-0" />
                            )}
                            <span className="truncate">{entry.displayName}</span>
                            {status?.optedIn && entry.displayName === status.displayName && (
                              <span className="shrink-0 text-xs bg-gradient-mars text-primary-foreground px-1.5 py-0.5 rounded">
                                You
                              </span>
                            )}
                          </div>
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

      <SaveProfileModal open={showSaveModal} onClose={() => setShowSaveModal(false)} />
      <RestoreProfileModal open={showRestoreModal} onClose={() => setShowRestoreModal(false)} />
    </main>
  );
}
