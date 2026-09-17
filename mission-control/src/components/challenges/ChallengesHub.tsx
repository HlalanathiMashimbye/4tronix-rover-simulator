'use client';

import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { CheckCircle2, Lock, Trophy } from 'lucide-react';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';
import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';
import type { ChallengeLevel } from '@/core/domain/entities/Challenge';
import { StaggeredEntrance } from '@/components/ui/StaggeredEntrance';

/**
 * Progressive Challenges hub - one card per level, each listing its
 * challenges. Locking, in-progress and complete states all derive from
 * useChallengeProgress rather than being tracked here, so this component has
 * no state of its own beyond the loading flag the hook already exposes.
 */
export function ChallengesHub() {
  const { loading, isLevelUnlocked, isChallengeComplete, completedCount, totalCount } =
    useChallengeProgress();
  const reduceMotion = useReducedMotion();

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
      </div>
    );
  }

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4 clay">
        <div className="flex items-center justify-between text-sm font-bold text-foreground">
          <span className="flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-primary" />
            Overall progress
          </span>
          <span className="tabular-nums text-muted-foreground">
            {completedCount}/{totalCount} complete
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary/60">
          <div
            className="h-full rounded-full bg-gradient-mars transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {CHALLENGE_LEVELS.map((level, index) => (
          <StaggeredEntrance key={level.id} index={index} reduceMotion={reduceMotion}>
            <LevelCard
              level={level}
              unlocked={isLevelUnlocked(level.id)}
              isChallengeComplete={isChallengeComplete}
            />
          </StaggeredEntrance>
        ))}
      </div>
    </div>
  );
}

function LevelCard({
  level,
  unlocked,
  isChallengeComplete,
}: {
  level: ChallengeLevel;
  unlocked: boolean;
  isChallengeComplete: (challengeId: (typeof level.challengeIds)[number]) => boolean;
}) {
  const challenges = level.challengeIds.map((id) => CHALLENGES[id]);
  const allComplete = challenges.every((c) => isChallengeComplete(c.id));

  const statusLabel = !unlocked ? 'Locked' : allComplete ? 'Complete' : 'In progress';
  const statusClass = !unlocked
    ? 'bg-secondary/60 text-muted-foreground'
    : allComplete
      ? 'bg-buzz/15 text-buzz'
      : 'bg-primary/15 text-primary';

  return (
    <section
      className={`rounded-2xl border p-4 clay ${
        unlocked ? 'border-border/60 bg-card/40' : 'border-border/40 bg-card/20 opacity-70'
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
          {unlocked ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
              {level.id}
            </span>
          ) : (
            <Lock className="h-4 w-4 text-muted-foreground" />
          )}
          Level {level.id}: {level.title}
        </h2>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusClass}`}>
          {statusLabel}
        </span>
      </header>

      <p className="mt-1 text-sm text-muted-foreground">{level.description}</p>
      {!unlocked && (
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          Complete Level {level.id - 1} to unlock.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {challenges.map((challenge) => {
          const complete = isChallengeComplete(challenge.id);
          const content = (
            <div
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                unlocked
                  ? 'border-border/60 bg-background/40 hover:border-foreground/25'
                  : 'border-border/30 bg-background/20'
              }`}
            >
              <div>
                <p className={`text-sm font-bold ${unlocked ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {challenge.title}
                </p>
                <p className="text-xs text-muted-foreground">{challenge.summary}</p>
              </div>
              {complete ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-buzz" />
              ) : unlocked ? (
                <span className="shrink-0 rounded-full bg-gradient-mars px-3 py-1.5 text-xs font-bold text-primary-foreground">
                  Start
                </span>
              ) : (
                <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </div>
          );

          return unlocked ? (
            <Link key={challenge.id} href={`/challenges/${challenge.id}`}>
              {content}
            </Link>
          ) : (
            <div key={challenge.id} aria-disabled="true">
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
