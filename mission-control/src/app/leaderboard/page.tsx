'use client';

import { useEffect, useState, useMemo } from 'react';
import { Trophy, LogIn, Star } from 'lucide-react';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useLearner } from '@/contexts/LearnerContext';
import { Avatar } from '@/components/learner/Avatar';
import { CHALLENGE_LEVELS } from '@/infrastructure/config/challenges';

interface LeaderboardEntry {
  displayName: string;
  score: number;
  completedChallenges: number;
}

const VISIBLE_COUNT = 10;

const TOTAL_CHALLENGES = CHALLENGE_LEVELS.reduce(
  (sum, level) => sum + level.challengeIds.length,
  0,
);

const AVATAR_PALETTE = [
  { bg: '#E86443', edge: '#B84D35' },
  { bg: '#4C97FF', edge: '#3373CC' },
  { bg: '#10B981', edge: '#0B8A60' },
  { bg: '#8B5CF6', edge: '#6D40D0' },
  { bg: '#F59E0B', edge: '#D08609' },
  { bg: '#EC4899', edge: '#BE3A7A' },
  { bg: '#06B6D4', edge: '#0591A8' },
  { bg: '#EF4444', edge: '#C03636' },
];

function nameColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function InitialAvatar({ name, size = 40 }: { name: string; size?: number }) {
  const color = nameColor(name);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-b-4 font-display font-bold"
      style={{
        width: size,
        height: size,
        backgroundColor: color.bg,
        borderColor: color.edge,
        fontSize: Math.round(size * 0.42),
        color: 'var(--kid-ink)',
      }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border-2 border-kid-panel-edge bg-kid-panel px-4 py-2 text-center min-w-[5.5rem]">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-kid-muted-text">
        {label}
      </p>
      <p
        className={`font-display text-xl font-bold leading-tight ${accent ? 'text-lb-accent' : 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  );
}

function rankBadgeClasses(rank: number): string {
  if (rank === 1) return 'bg-lb-gold border-lb-gold-edge text-kid-ink';
  if (rank === 2) return 'bg-lb-silver border-lb-silver-edge text-kid-ink';
  if (rank === 3) return 'bg-lb-bronze border-lb-bronze-edge text-kid-ink';
  return 'bg-lb-rank border-lb-rank-edge text-foreground';
}

function rowClasses(rank: number, highlighted: boolean): string {
  if (highlighted) return 'bg-lb-row border-kid-blue';
  if (rank === 1) return 'bg-lb-row-gold border-lb-row-edge';
  if (rank === 2) return 'bg-lb-row-silver border-lb-row-edge';
  if (rank === 3) return 'bg-lb-row-bronze border-lb-row-edge';
  return 'bg-lb-row border-lb-row-edge';
}

function LeaderboardRow({
  entry,
  rank,
  isCurrentUser,
  highlighted,
}: {
  entry: LeaderboardEntry;
  rank: number;
  isCurrentUser?: boolean;
  highlighted?: boolean;
}) {
  return (
    <div
      role="listitem"
      className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5 ${rowClasses(rank, !!highlighted)}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-b-4 font-display text-sm font-bold sm:h-10 sm:w-10 sm:text-base ${rankBadgeClasses(rank)}`}
      >
        {rank}
      </span>

      <InitialAvatar name={entry.displayName} size={36} />

      <span className="min-w-0 flex-1 truncate font-display font-bold text-foreground text-sm sm:text-base">
        {entry.displayName}
        {isCurrentUser && (
          <span className="ml-2 inline-block rounded-full bg-kid-panel-edge px-2 py-0.5 text-[0.65rem] font-bold text-kid-muted-text align-middle uppercase tracking-wide">
            YOU
          </span>
        )}
      </span>

      <span className="hidden shrink-0 rounded-full bg-kid-panel-edge px-3 py-1 text-xs font-semibold text-kid-muted-text sm:inline-flex">
        {entry.completedChallenges} {entry.completedChallenges === 1 ? 'challenge' : 'challenges'}
      </span>

      <span className="shrink-0 rounded-full border-2 border-lb-score-edge bg-lb-score-bg px-3 py-0.5 font-display text-sm font-bold tabular-nums text-lb-score-text">
        {entry.score}
      </span>
    </div>
  );
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status, optIn } = useLeaderboard();
  const { learner } = useLearner();

  const loadLeaderboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/leaderboard');
      if (!response.ok) throw new Error('Failed to load leaderboard');
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
    const idx = entries.findIndex((e) => e.displayName === status.displayName);
    if (idx >= 0) return idx + 1;
    return status.rank ?? null;
  }, [entries, status]);

  const visibleEntries = entries.slice(0, VISIBLE_COUNT);
  const userInVisible = !!(learnerRank && learnerRank <= VISIBLE_COUNT);

  const userEntry: LeaderboardEntry | null = useMemo(() => {
    if (!status?.optedIn || !learnerRank || userInVisible) return null;
    return (
      entries.find((e) => e.displayName === status.displayName) ?? {
        displayName: status.displayName,
        score: status.score,
        completedChallenges: status.completedChallenges,
      }
    );
  }, [status, learnerRank, userInVisible, entries]);

  const progressPct =
    status && TOTAL_CHALLENGES > 0
      ? Math.round((status.completedChallenges / TOTAL_CHALLENGES) * 100)
      : 0;

  // ---------- Opt-in prompt ----------
  if (status && !status.optedIn) {
    return (
      <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
        <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Leader<span className="text-lb-accent">board</span>
          </h1>
        </header>

        <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col items-center justify-center pb-5">
          <div className="rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel p-8 max-w-md text-center">
            {learner?.avatar ? (
              <div className="mx-auto mb-4">
                <Avatar avatar={learner.avatar} size={80} />
              </div>
            ) : (
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-b-4 bg-kid-orange border-kid-orange-edge">
                <Trophy className="h-10 w-10 text-kid-ink" />
              </div>
            )}
            <h2 className="font-display text-2xl font-bold text-foreground mb-2">
              Join the Leaderboard
            </h2>
            {learner?.displayName ? (
              <p className="text-sm text-kid-muted-text mb-6">
                You&apos;ll appear as{' '}
                <span className="font-semibold text-foreground">{learner.displayName}</span> on the
                leaderboard. See how you rank among other learners!
              </p>
            ) : (
              <p className="text-sm text-kid-muted-text mb-6">
                See how you rank among other learners. Your real identity stays private.
              </p>
            )}

            <button
              onClick={optIn}
              className="inline-flex min-h-11 w-full select-none items-center justify-center gap-2 rounded-full border-b-4 bg-kid-orange border-kid-orange-edge px-5 font-display font-bold text-kid-ink transition-[transform,border-bottom-width] duration-100 active:translate-y-0.5 active:border-b-2"
            >
              <LogIn className="h-4 w-4" />
              Join the leaderboard
            </button>

            <p className="text-xs text-kid-muted-text mt-4">
              You can leave anytime without affecting your progress.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // ---------- Main view ----------
  return (
    <main className="relative flex h-page flex-col overflow-hidden px-4 sm:px-6">
      <header className="mx-auto w-full max-w-page shrink-0 pt-4 pb-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Leader<span className="text-lb-accent">board</span>
        </h1>
        <p className="mt-0.5 text-sm text-kid-muted-text">
          See how you stack up. Finish challenges to climb the ranks!
        </p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col gap-4 overflow-y-auto scroll-panel pb-5">
        {/* Your Status Card */}
        {status && status.optedIn && (
          <>
            {/* Desktop: kid-friendly stat card */}
            <div className="hidden md:block shrink-0">
              <div className="rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel p-5">
                <div className="flex items-center gap-5">
                  {learner?.avatar ? (
                    <Avatar avatar={learner.avatar} size={56} />
                  ) : (
                    <InitialAvatar name={status.displayName} size={56} />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-bold text-foreground truncate">
                      {status.displayName}
                    </p>
                    <p className="text-sm text-kid-muted-text">
                      {status.completedChallenges === 0
                        ? "That’s you! Your first star is waiting."
                        : `That’s you! ${status.completedChallenges} star${status.completedChallenges === 1 ? '' : 's'} earned.`}
                    </p>
                    <div
                      className="mt-2.5 h-3 overflow-hidden rounded-full bg-kid-panel-edge"
                      role="progressbar"
                      aria-label="Challenge progress"
                      aria-valuemin={0}
                      aria-valuemax={TOTAL_CHALLENGES}
                      aria-valuenow={status.completedChallenges}
                    >
                      <div
                        className="h-full rounded-full bg-kid-green transition-[width] duration-300 ease-out"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 shrink-0">
                    <StatTile
                      label="YOUR RANK"
                      value={learnerRank ? `#${learnerRank}` : '—'}
                      accent
                    />
                    <StatTile
                      label="CHALLENGES"
                      value={`${status.completedChallenges} of ${TOTAL_CHALLENGES}`}
                    />
                    <StatTile label="SCORE" value={String(status.score)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile: preserved existing layout */}
            <div className="md:hidden shrink-0 space-y-3">
              <div className="rounded-2xl border border-border bg-card p-4 clay">
                <div className="flex items-center gap-4">
                  <Avatar avatar={learner?.avatar} size={48} />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                      Your Rank
                    </p>
                    <p className="text-2xl font-bold text-gradient-mars">
                      {learnerRank ? `#${learnerRank}` : '—'}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground truncate">
                  {status.displayName}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border bg-card p-4 clay">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-mars/15">
                    <Trophy className="h-5 w-5" style={{ color: 'var(--mars)' }} />
                  </div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Challenges
                  </p>
                  <p className="text-2xl font-bold text-foreground">
                    {status.completedChallenges}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-card p-4 clay">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Star className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Score
                  </p>
                  <p className="text-2xl font-bold text-foreground">{status.score}</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Top Learners */}
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-kid-panel-edge border-t-kid-blue" />
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-destructive/40 bg-destructive/10 p-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="font-display font-bold text-foreground">
                  No one on the leaderboard yet
                </p>
                <p className="text-sm text-kid-muted-text mt-1">Be the first to join!</p>
              </div>
            </div>
          ) : (
            <section className="rounded-3xl border-x-2 border-t-2 border-b-4 border-lb-accent/50 bg-kid-panel p-4 sm:p-5">
              <header className="flex items-center gap-3 mb-4">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-b-4 bg-kid-orange border-kid-orange-edge"
                  aria-hidden="true"
                >
                  <Trophy className="h-5 w-5 text-kid-ink" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-bold text-kid-orange-text">
                    Top Learners
                  </h2>
                  <p className="text-sm text-kid-muted-text">
                    Ranked by completed challenges
                  </p>
                </div>
              </header>

              <div className="space-y-2" role="list">
                {visibleEntries.map((entry, index) => (
                  <LeaderboardRow
                    key={entry.displayName}
                    entry={entry}
                    rank={index + 1}
                    isCurrentUser={
                      !!(status?.optedIn && entry.displayName === status?.displayName)
                    }
                  />
                ))}

                {userEntry && learnerRank && (
                  <>
                    <div
                      className="flex items-center justify-center gap-2 py-1 font-display text-lg font-bold tracking-widest text-kid-muted-text"
                      aria-hidden="true"
                    >
                      · · ·
                    </div>
                    <LeaderboardRow
                      entry={userEntry}
                      rank={learnerRank}
                      isCurrentUser
                      highlighted
                    />
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
