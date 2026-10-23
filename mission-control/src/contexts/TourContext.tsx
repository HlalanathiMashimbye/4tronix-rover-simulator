'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { hasSeenWelcome } from '@/infrastructure/browser/platformMilestones';

const COMPLETED_KEY = 'tour-completed';
const STEP_KEY = 'tour-step';

export interface TourStep {
  id: string;
  /** data-tour-id to spotlight, or null for a centre-screen modal (welcome). */
  target: string | null;
  /** Additional data-tour-id values to spotlight alongside the primary target. */
  extraTargets?: string[];
  title: string;
  body: string;
  placement: 'center' | 'top' | 'bottom' | 'left' | 'right';
  mobilePlacement?: 'top' | 'bottom' | 'left' | 'right';
  glow?: boolean;
  /** Programmatically click the target when the learner presses Next. */
  clickTargetOnNext?: boolean;
  /** Skip this step when the learner is already on this path. */
  skipIfPath?: string;
  /** Navigate to this path when the learner presses Next on this step. */
  navigateTo?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: null,
    title: 'Welcome to Mission Control!',
    body: 'See how other learners drive a real Mars rover, then build and send your own mission.',
    placement: 'center',
  },
  {
    id: 'first-mission',
    target: 'tour-first-mission',
    title: 'Explore a Mission',
    body: 'This is a mission by another learner. Click it to see what it does!',
    placement: 'bottom',
    clickTargetOnNext: true,
  },
  {
    id: 'mission-code',
    target: 'tour-mission-code',
    title: 'The Code',
    body: 'This is the code that drove the rover. Every mission starts as blocks or Python.',
    placement: 'left',
    mobilePlacement: 'top',
  },
  {
    id: 'mission-video',
    target: 'tour-mission-video',
    title: 'Watch It Run',
    body: 'The simulation shows how the code plays out on Mars.',
    placement: 'right',
    mobilePlacement: 'bottom',
  },
  {
    id: 'create-mission',
    target: 'tour-create-mission',
    title: 'Create Your Own!',
    body: "Now it's your turn: build a mission from scratch!",
    placement: 'bottom',
    mobilePlacement: 'top',
    glow: true,
    clickTargetOnNext: true,
    navigateTo: '/mission',
  },
  {
    id: 'manual-mode',
    target: 'tour-manual-mode',
    title: 'Drive Mode',
    body: 'Start here! Tap a button to drive the rover and see what it can do.',
    placement: 'bottom',
  },
  {
    id: 'drive-buttons',
    target: 'tour-drive-buttons',
    title: 'Take the Wheel',
    body: 'Hold a button and watch the rover move in the simulator!',
    placement: 'top',
  },
  {
    id: 'blockly-mode',
    target: 'tour-blockly-mode',
    title: 'Block Editor',
    body: 'Now try blocks! Drag and snap them together to build a sequence.',
    placement: 'bottom',
    clickTargetOnNext: true,
  },
  {
    id: 'blockly-editor',
    target: 'tour-blockly-editor',
    title: 'Build Your Mission',
    body: 'Drag a Move Forward block from the toolbox into the workspace.',
    placement: 'right',
    mobilePlacement: 'top',
  },
  {
    id: 'python-mode',
    target: 'tour-python-mode',
    title: 'Python Code',
    body: 'Ready for real code? Write Python commands to drive the rover.',
    placement: 'bottom',
    clickTargetOnNext: true,
  },
  {
    id: 'code-instructions',
    target: 'tour-code-instructions',
    extraTargets: ['tour-python-editor'],
    title: 'Rover Commands',
    body: 'Click here to see every command the rover understands. Pick one to add it to your code!',
    placement: 'right',
    mobilePlacement: 'bottom',
  },
  {
    id: 'run-mission',
    target: 'tour-run-mission',
    title: 'Launch!',
    body: 'Hit Run to see your mission play out in the simulator.',
    placement: 'left',
    mobilePlacement: 'bottom',
    clickTargetOnNext: true,
  },
  {
    id: 'send-mission',
    target: 'tour-send-mission',
    title: 'Mission Complete!',
    body: "You've built your first mission! Send it to Mission Control and a real rover will run your code.",
    placement: 'top',
    mobilePlacement: 'top',
    glow: true,
  },
];

interface TourContextType {
  active: boolean;
  step: number;
  currentStep: TourStep | null;
  totalSteps: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  completed: boolean;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export function TourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState(true);

  useEffect(() => {
    try {
      const done = localStorage.getItem(COMPLETED_KEY) === 'true';
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading persisted state once on mount
      setCompleted(done);
      if (!done) {
        const saved = localStorage.getItem(STEP_KEY);
        if (saved !== null && hasSeenWelcome()) {
          setActive(true);
          setStep(parseInt(saved, 10));
        } else if (saved !== null) {
          // Stale tour-step from another learner on a shared machine.
          localStorage.removeItem(STEP_KEY);
        }
      }
    } catch { /* localStorage unavailable */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  const finish = useCallback(() => {
    setActive(false);
    setCompleted(true);
    try {
      localStorage.setItem(COMPLETED_KEY, 'true');
      localStorage.removeItem(STEP_KEY);
    } catch { /* */ }
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (next >= TOUR_STEPS.length) {
        finish();
        return;
      }
      setStep(next);
      try { localStorage.setItem(STEP_KEY, String(next)); } catch { /* */ }
    },
    [finish],
  );

  /** Resolve which step to land on, skipping steps whose skipIfPath matches exactly. */
  const resolve = useCallback(
    (from: number, path: string): number => {
      let i = from;
      while (i < TOUR_STEPS.length && TOUR_STEPS[i].skipIfPath && path === TOUR_STEPS[i].skipIfPath) {
        i += 1;
      }
      return i;
    },
    [],
  );

  const advance = useCallback(() => {
    const next = resolve(step + 1, pathname);
    goTo(next);
  }, [step, pathname, resolve, goTo]);

  const handleNext = useCallback(() => {
    const current = TOUR_STEPS[step];
    if (current?.clickTargetOnNext && current.target) {
      const el = document.querySelector(`[data-tour-id="${current.target}"]`);
      if (el instanceof HTMLElement) {
        el.click();
      }
    }
    if (current?.navigateTo) {
      router.push(current.navigateTo);
    }
    advance();
  }, [step, advance, router]);

  const handlePrev = useCallback(() => {
    if (step > 0) goTo(step - 1);
  }, [step, goTo]);

  const start = useCallback(() => {
    router.push('/');
    setActive(true);
    goTo(0);
  }, [goTo, router]);

  const skip = useCallback(() => finish(), [finish]);

  // Re-resolve on navigation in case we land on a page that makes the current step skippable.
  useEffect(() => {
    if (!active) return;
    const resolved = resolve(step, pathname);
    if (resolved !== step) goTo(resolved);
  }, [active, step, pathname, resolve, goTo]);

  const currentStep = active && step < TOUR_STEPS.length ? TOUR_STEPS[step] : null;

  return (
    <TourContext.Provider
      value={{
        active,
        step,
        currentStep,
        totalSteps: TOUR_STEPS.length,
        start,
        next: handleNext,
        prev: handlePrev,
        skip,
        completed,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

const NOOP_TOUR: TourContextType = {
  active: false,
  step: 0,
  currentStep: null,
  totalSteps: 0,
  start: () => {},
  next: () => {},
  prev: () => {},
  skip: () => {},
  completed: true,
};

export function useTour() {
  const context = useContext(TourContext);
  return context ?? NOOP_TOUR;
}
