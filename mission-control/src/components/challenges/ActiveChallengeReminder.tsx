'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, ChevronDown, X } from 'lucide-react';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import type { ChallengeId } from '@/core/domain/entities/Challenge';

/**
 * Compact floating card shown on non-challenge pages when the learner has a
 * challenge in progress. Lets them see the current step instruction without
 * navigating back to the challenge workspace.
 */
export function ActiveChallengeReminder() {
  const pathname = usePathname();
  const { progress, loading, isChallengeComplete } = useChallengeProgress();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (loading) return null;
  if (pathname.startsWith('/challenges')) return null;

  const activeChallengeId = findActiveChallenge(progress.currentStepByChallenge, isChallengeComplete);
  if (!activeChallengeId) return null;
  if (dismissed === activeChallengeId) return null;

  const challenge = CHALLENGES[activeChallengeId];
  if (!challenge) return null;

  const stepIndex = progress.currentStepByChallenge?.[activeChallengeId] ?? 0;
  const step = challenge.steps[stepIndex];
  if (!step) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-40 mx-auto max-w-md sm:left-4 sm:right-auto sm:bottom-24">
      <div className="panel rounded-xl border border-primary/30 bg-card/95 shadow-xl backdrop-blur-sm clay">
        {/* Header bar */}
        <div className="flex items-center gap-2 px-3 py-2">
          <BookOpen className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-primary">
              {challenge.title}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Step {stepIndex + 1}/{challenge.steps.length}: {step.title}
            </p>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="clay-press shrink-0 rounded-lg border border-border/60 bg-card/50 p-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </button>

          <button
            onClick={() => setDismissed(activeChallengeId)}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Expandable instruction body */}
        {expanded && (
          <div className="border-t border-border/60 px-3 py-2">
            <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
              {step.instructions}
            </p>
          </div>
        )}

        {/* Back link */}
        <div className="border-t border-border/60 px-3 py-1.5">
          <Link
            href={`/challenges/${activeChallengeId}`}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Back to challenge →
          </Link>
        </div>
      </div>
    </div>
  );
}

function findActiveChallenge(
  currentStepByChallenge: Partial<Record<ChallengeId, number>> | undefined,
  isChallengeComplete: (id: ChallengeId) => boolean,
): ChallengeId | null {
  if (!currentStepByChallenge) return null;

  for (const id of Object.keys(currentStepByChallenge) as ChallengeId[]) {
    if (!isChallengeComplete(id)) return id;
  }
  return null;
}
