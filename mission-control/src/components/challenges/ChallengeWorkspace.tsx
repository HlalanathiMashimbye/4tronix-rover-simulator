'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PartyPopper } from 'lucide-react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { useSearch } from '@/contexts/SearchContext';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';
import {
  evaluateCheck,
  type ChallengeEvalContext,
  type TrajectoryOutcome,
} from '@/core/application/services/ChallengeCheckEvaluator';
import { writeChallengeHandoff } from '@/infrastructure/browser/challengeHandoff';
import { readMilestones } from '@/infrastructure/browser/platformMilestones';
import { ChallengeInstructionsPanel } from './ChallengeInstructionsPanel';
import { ChallengeCenterPanel } from './ChallengeCenterPanel';

interface ChallengeWorkspaceProps {
  challenge: Challenge;
}

const FINISH_LABEL: Record<Challenge['workspaceKind'], string> = {
  'embedded-platform': 'Finish challenge',
  'blockly-sim': 'Finish & Export',
  'monaco-sim': 'Finish & Export',
};

interface FinishResult {
  justUnlockedLevelId: number | null;
}

/**
 * 2-panel challenge workspace below instructions: the real platform,
 * Blockly canvas, or Monaco editor (left), and the simulator (right).
 * Owns step navigation and re-evaluates the current step's checks every
 * render from whatever's live - SearchContext for an embedded-platform
 * challenge, the editor's generated code and last simulated run for a
 * blockly-sim or monaco-sim one.
 *
 * Finishing a code challenge hands the solution to Create Mission
 * (sessionStorage, see infrastructure/browser/challengeHandoff.ts) instead of
 * returning to the hub - the code was just validated here, so the natural
 * next step is sending it to a real rover, not browsing challenges again.
 */
export function ChallengeWorkspace({ challenge }: ChallengeWorkspaceProps) {
  const router = useRouter();
  const { query, activeFilter } = useSearch();
  const { completeChallenge } = useChallengeProgress();

  const [stepIndex, setStepIndex] = useState(0);
  const [loadMoreCalled, setLoadMoreCalled] = useState(false);
  // Undefined until MissionFeed reports it - see ChallengeCheckEvaluator's
  // feedHasMore doc: undefined must NOT be treated as "nothing more to
  // load", only an explicit false may.
  const [feedHasMore, setFeedHasMore] = useState<boolean | undefined>(undefined);
  /**
   * Read once on mount, not on every render: the facts it holds are only
   * changed by pages OTHER than this one, and getting back to those pages
   * unmounts this component. A learner who opens History and returns gets a
   * fresh read on the way back in, which is exactly when it matters.
   */
  const [milestones, setMilestones] = useState(() => ({ visitedRoutes: [] as string[], missionCreated: false }));
  useEffect(() => {
    setMilestones(readMilestones());
  }, []);

  const [generatedCode, setGeneratedCode] = useState('');
  const [blocklyState, setBlocklyState] = useState('');
  const [trajectoryOutcomes, setTrajectoryOutcomes] = useState<TrajectoryOutcome[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);

  const step = challenge.steps[stepIndex];

  const evalContext: ChallengeEvalContext = useMemo(
    () => ({
      search: { query, activeFilter },
      loadMoreCalled,
      feedHasMore,
      generatedCode,
      trajectoryOutcomes,
      visitedRoutes: milestones.visitedRoutes,
      missionCreated: milestones.missionCreated,
    }),
    [query, activeFilter, loadMoreCalled, feedHasMore, generatedCode, trajectoryOutcomes, milestones],
  );

  const results = step ? step.checks.map((check) => evaluateCheck(check, evalContext)) : [];
  const allStepChecksPass = results.every(Boolean);
  const isFinalStep = stepIndex === challenge.steps.length - 1;
  const isCodeChallenge = challenge.workspaceKind !== 'embedded-platform';

  const handleFinish = async () => {
    setFinishing(true);
    try {
      const justUnlockedLevelId = await completeChallenge(challenge.id);

      if (challenge.workspaceKind === 'blockly-sim') {
        writeChallengeHandoff({
          challengeId: challenge.id,
          challengeTitle: challenge.title,
          code: generatedCode,
          editorMode: 'blockly',
          blocklyState,
        });
      } else if (challenge.workspaceKind === 'monaco-sim') {
        writeChallengeHandoff({
          challengeId: challenge.id,
          challengeTitle: challenge.title,
          code: generatedCode,
          editorMode: 'code',
        });
      }

      setFinishResult({ justUnlockedLevelId });
      const destination = isCodeChallenge ? '/mission' : '/challenges';
      setTimeout(() => router.push(destination), justUnlockedLevelId ? 1800 : 900);
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
    <div className="relative flex min-h-0 flex-1 flex-col gap-2">
      <ChallengeInstructionsPanel
        step={step}
        stepIndex={stepIndex}
        totalSteps={challenge.steps.length}
        canGoBack={stepIndex > 0}
        canGoNext={allStepChecksPass}
        isFinalStep={isFinalStep}
        allStepChecksPass={allStepChecksPass}
        checks={step.checks}
        results={results}
        finishLabel={FINISH_LABEL[challenge.workspaceKind]}
        onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
        onNext={() => setStepIndex((i) => Math.min(challenge.steps.length - 1, i + 1))}
        onFinish={handleFinish}
        finishing={finishing}
      />

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="min-h-0 flex-1">
          <ChallengeCenterPanel
            challenge={challenge}
            onLoadMore={() => setLoadMoreCalled(true)}
            onFeedState={({ hasMore }) => setFeedHasMore(hasMore)}
            onCodeChange={setGeneratedCode}
            onBlocklyStateChange={setBlocklyState}
            onTrajectoryOutcomes={setTrajectoryOutcomes}
          />
        </div>
      </div>

      {/* Same plain-CSS mount/visible pattern as MissionSubmitBar's success
          banner (not motion's AnimatePresence - see that component for why:
          a known bug where its exit animation completes but the node never
          actually unmounts). This overlay never needs to unmount early
          anyway, since a route change follows shortly after it appears. */}
      {finishResult && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-3xl border border-primary/40 bg-card p-8 text-center clay">
            <PartyPopper className="h-10 w-10 text-primary" />
            <p className="font-display text-xl font-bold text-foreground">
              {finishResult.justUnlockedLevelId
                ? `Level ${finishResult.justUnlockedLevelId} unlocked!`
                : 'Challenge complete!'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isCodeChallenge ? 'Carrying your code into Create Mission…' : 'Heading back to Challenges…'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
