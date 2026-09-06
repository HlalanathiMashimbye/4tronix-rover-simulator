'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChallengeStep } from '@/core/domain/entities/Challenge';

interface ChallengeInstructionsPanelProps {
  step: ChallengeStep;
  stepIndex: number;
  totalSteps: number;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Left rail: the current step's title and instructions (LinkedIn-Learning
 * style step-by-step text), and Back/Next. Next is gated on the step's own
 * checks having passed - a learner cannot skip ahead of a step they have not
 * actually completed, which is the point of a guided walkthrough.
 *
 * This panel used to carry CAPS/CSTA curriculum pills above the instructions.
 * They are gone, and the reason is worth keeping: the readable half of that
 * metadata sat in a `title` tooltip, which does not exist on touch, so the
 * only part a learner ever saw was a code like "CSTA 2-AP-12". The rail is the
 * learner's working surface and the narrowest column on the page - whatever
 * competes with the instructions here had better be aimed at the person
 * reading them. See infrastructure/config/challenges.ts for why the mapping
 * came out of the content entirely rather than moving somewhere roomier.
 */
export function ChallengeInstructionsPanel({
  step,
  stepIndex,
  totalSteps,
  canGoBack,
  canGoNext,
  onBack,
  onNext,
}: ChallengeInstructionsPanelProps) {
  return (
    <div className="panel flex h-full w-full flex-col gap-3 overflow-y-auto border border-border/60 bg-card/40 p-4 clay lg:w-80 lg:shrink-0">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
        Step {stepIndex + 1} of {totalSteps}
      </p>
      <h2 className="font-display text-lg font-bold text-foreground">{step.title}</h2>

      {/* whitespace-pre-line: step instructions carry hand-written newlines to
          lay out code samples (see the Level 3 steps), which collapse without it. */}
      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{step.instructions}</p>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className="clay-press flex items-center gap-1 rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-xs font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        {stepIndex < totalSteps - 1 && (
          <button
            onClick={onNext}
            disabled={!canGoNext}
            className="clay clay-press flex items-center gap-1 rounded-xl bg-gradient-mars px-3 py-2 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
