'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PartyPopper } from 'lucide-react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { useSearch } from '@/contexts/SearchContext';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';
import { evaluateCheck, type ChallengeEvalContext } from '@/core/application/services/ChallengeCheckEvaluator';
import { ChallengeInstructionsPanel } from './ChallengeInstructionsPanel';
import { ChallengeCenterPanel } from './ChallengeCenterPanel';
import { ChallengeChecklistPanel } from './ChallengeChecklistPanel';

interface ChallengeWorkspaceProps {
  challenge: Challenge;
}

const FINISH_LABEL: Record<Challenge['workspaceKind'], string> = {
  'embedded-platform': 'Finish challenge',
  'blockly-sim': 'Finish & Export',
};

/**
 * The 3-panel challenge workspace: instructions (left), the real platform or
 * Blockly canvas (center), and a live checklist (right). Owns step
 * navigation and re-evaluates the current step's checks every render from
 * whatever's live - SearchContext for an embedded-platform challenge today,
 * a Blockly workspace/trajectory for blockly-sim ones once that panel lands.
 */
export function ChallengeWorkspace({ challenge }: ChallengeWorkspaceProps) {
  const router = useRouter();
  const { query, activeFilter } = useSearch();
  const { completeChallenge } = useChallengeProgress();

  const [stepIndex, setStepIndex] = useState(0);
  const [loadMoreCalled, setLoadMoreCalled] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [unlockedLevelId, setUnlockedLevelId] = useState<number | null>(null);

  const step = challenge.steps[stepIndex];

  const evalContext: ChallengeEvalContext = useMemo(
    () => ({ search: { query, activeFilter }, loadMoreCalled }),
    [query, activeFilter, loadMoreCalled],
  );

  const results = step ? step.checks.map((check) => evaluateCheck(check, evalContext)) : [];
  const allStepChecksPass = results.every(Boolean);
  const isFinalStep = stepIndex === challenge.steps.length - 1;

  const handleFinish = async () => {
    setFinishing(true);
    try {
      const justUnlockedLevelId = await completeChallenge(challenge.id);
      setUnlockedLevelId(justUnlockedLevelId);
      setTimeout(() => router.push('/challenges'), justUnlockedLevelId ? 1800 : 900);
    } finally {
      setFinishing(false);
    }
  };

  if (!step) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        This challenge has no steps configured yet.
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
      <ChallengeInstructionsPanel
        step={step}
        stepIndex={stepIndex}
        totalSteps={challenge.steps.length}
        canGoBack={stepIndex > 0}
        canGoNext={allStepChecksPass}
        onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
        onNext={() => setStepIndex((i) => Math.min(challenge.steps.length - 1, i + 1))}
      />

      <div className="min-h-0 flex-1">
        <ChallengeCenterPanel challenge={challenge} onLoadMore={() => setLoadMoreCalled(true)} />
      </div>

      <ChallengeChecklistPanel
        checks={step.checks}
        results={results}
        hints={step.hints}
        isFinalStep={isFinalStep}
        allStepChecksPass={allStepChecksPass}
        finishLabel={FINISH_LABEL[challenge.workspaceKind]}
        onFinish={handleFinish}
        finishing={finishing}
      />

      {/* Same plain-CSS mount/visible pattern as MissionSubmitBar's success
          banner (not motion's AnimatePresence - see that component for why:
          a known bug where its exit animation completes but the node never
          actually unmounts). This overlay never needs to unmount early
          anyway, since a route change follows shortly after it appears. */}
      {unlockedLevelId !== null && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-primary/40 bg-card p-8 text-center clay">
            <PartyPopper className="h-10 w-10 text-primary" />
            <p className="font-display text-xl font-bold text-foreground">Level {unlockedLevelId} unlocked!</p>
            <p className="text-sm text-muted-foreground">Heading back to Challenges…</p>
          </div>
        </div>
      )}
    </div>
  );
}
