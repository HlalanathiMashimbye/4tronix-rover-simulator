'use client';

/**
 * The same ChallengeInstructionsPanel that shows on the challenge page, rendered
 * inline at the top of every OTHER page while a challenge is in progress.
 *
 * Replaces the old ReturnToChallenge floating card. A learner doing Level 1
 * who is sent to History, the Leaderboard or Create Mission now sees the full
 * step instructions, progress dots, checklist (with route-visited checks
 * turning green), hints, and Back/Next/Finish — the same card, the same
 * controls, the same position at the top of the page.
 *
 * Hidden on /challenges/* (where ChallengeWorkspace renders its own panel) and
 * /operator/* (an operator is not doing a challenge).
 */

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import {
  clearActiveChallenge,
  readActiveChallenge,
  recordActiveChallenge,
  type ActiveChallenge,
} from '@/infrastructure/browser/activeChallenge';
import { normaliseRoute, readMilestones } from '@/infrastructure/browser/platformMilestones';
import { useSearch } from '@/contexts/SearchContext';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';
import {
  evaluateCheck,
  type ChallengeEvalContext,
} from '@/core/application/services/ChallengeCheckEvaluator';
import { playLevelUnlockSound } from '@/infrastructure/browser/levelUnlockSound';
import { readStoredSound, serverSoundSnapshot, subscribeToSound } from '@/hooks/soundPreference';
import type { ChallengeId } from '@/core/domain/entities/Challenge';
import { ChallengeInstructionsPanel } from './ChallengeInstructionsPanel';
import { explainOpenCheck } from './describeCheck';

const FINISH_LABEL: Record<string, string> = {
  'embedded-platform': 'Finish challenge',
  'blockly-sim': 'Finish & Export',
  'monaco-sim': 'Finish & Export',
};

export function PersistentChallengePanel() {
  const pathname = usePathname();
  const router = useRouter();
  const { query, activeFilter } = useSearch();
  const { completeChallenge } = useChallengeProgress();
  const muted = useSyncExternalStore(subscribeToSound, readStoredSound, serverSoundSnapshot);

  const [active, setActive] = useState<ActiveChallenge | null>(null);
  const [milestones, setMilestones] = useState({ visitedRoutes: [] as string[], missionCreated: false });
  const [finishing, setFinishing] = useState(false);
  const [prediction, setPrediction] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is browser-only
    setActive(readActiveChallenge());
  }, [pathname]);

  // Read milestones immediately and again after a tick. MilestoneTracker
  // records the current route in its own effect from the same navigation;
  // the deferred re-read picks that up so a route-visited check turns green
  // on the page that satisfied it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is browser-only
    setMilestones(readMilestones());
    const timer = setTimeout(() => setMilestones(readMilestones()), 50);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Derive everything unconditionally so hooks below can reference the results.
  const here = pathname ? normaliseRoute(pathname) : '';
  const visible = Boolean(
    pathname && active && !here.startsWith('/challenges') && !here.startsWith('/operator'),
  );
  const challenge = active ? CHALLENGES[active.challengeId as ChallengeId] : undefined;
  const step = challenge?.steps[active?.stepIndex ?? 0];
  const stepIndex = active?.stepIndex ?? 0;

  const evalContext: ChallengeEvalContext = {
    search: { query, activeFilter },
    visitedRoutes: milestones.visitedRoutes,
    missionCreated: milestones.missionCreated,
    predictionMade: prediction !== null,
  };

  const results = step ? step.checks.map((check) => evaluateCheck(check, evalContext)) : [];
  const allStepChecksPass = results.every(Boolean);
  const isFinalStep = challenge ? stepIndex === challenge.steps.length - 1 : false;
  const hasChecks = step ? step.checks.length > 0 : false;

  const prevAllPassRef = useRef(allStepChecksPass);

  // An Effect Event, for the same reason as ChallengeWorkspace's: the timer
  // runs the step that is current when it fires.
  const advance = useEffectEvent(() => {
    if (!challenge || !active) return;
    if (isFinalStep) {
      if (finishing) return;
      setFinishing(true);
      completeChallenge(challenge.id)
        .then((justUnlockedLevelId) => {
          clearActiveChallenge();
          if (justUnlockedLevelId && !muted) playLevelUnlockSound();
          router.push('/challenges');
        })
        .finally(() => setFinishing(false));
    } else {
      const newIndex = Math.min(challenge.steps.length - 1, stepIndex + 1);
      recordActiveChallenge({ challengeId: challenge.id, stepIndex: newIndex });
      setActive({ challengeId: challenge.id, stepIndex: newIndex });
    }
  });

  useEffect(() => {
    prevAllPassRef.current = allStepChecksPass;
  }, [stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- sync ref when navigating between steps

  useEffect(() => {
    const wasComplete = prevAllPassRef.current;
    prevAllPassRef.current = allStepChecksPass;
    if (!allStepChecksPass || wasComplete || !hasChecks || !visible) return;
    const timer = setTimeout(() => advance(), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the false→true transition only
  }, [allStepChecksPass, hasChecks, visible]);

  if (!visible || !challenge || !step) return null;

  const explanations = step.checks.map((check, i) => explainOpenCheck(check, evalContext, results[i]));

  return (
    <div data-surface="challenges" className="sticky top-[var(--app-chrome)] z-30 bg-background px-3 md:relative md:top-auto md:z-auto md:bg-transparent md:px-6">
      <div className="mx-auto max-w-page">
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
          explanations={explanations}
          finishLabel={FINISH_LABEL[challenge.workspaceKind] ?? 'Finish challenge'}
          onBack={() => {
            const newIndex = Math.max(0, stepIndex - 1);
            recordActiveChallenge({ challengeId: challenge.id, stepIndex: newIndex });
            setActive({ challengeId: challenge.id, stepIndex: newIndex });
          }}
          onNext={() => {
            const newIndex = Math.min(challenge.steps.length - 1, stepIndex + 1);
            recordActiveChallenge({ challengeId: challenge.id, stepIndex: newIndex });
            setActive({ challengeId: challenge.id, stepIndex: newIndex });
          }}
          onFinish={async () => {
            setFinishing(true);
            try {
              const justUnlockedLevelId = await completeChallenge(challenge.id);
              clearActiveChallenge();
              if (justUnlockedLevelId && !muted) playLevelUnlockSound();
              router.push('/challenges');
            } finally {
              setFinishing(false);
            }
          }}
          finishing={finishing}
          prediction={prediction}
          onPredict={setPrediction}
        />
      </div>
    </div>
  );
}
