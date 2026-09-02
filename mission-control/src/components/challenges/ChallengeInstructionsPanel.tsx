'use client';

import { ChevronLeft, ChevronRight, Rocket } from 'lucide-react';
import type { ChallengeStandards, ChallengeStep } from '@/core/domain/entities/Challenge';

interface ChallengeInstructionsPanelProps {
  step: ChallengeStep;
  standards?: ChallengeStandards;
  stepIndex: number;
  totalSteps: number;
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
}

const PILL_CLASS =
  'rounded-full border border-border/60 bg-secondary/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground';

/**
 * Left rail: the current step's title and instructions (LinkedIn-Learning
 * style step-by-step text), curriculum-alignment pills, and Back/Next.
 * Next is gated on the step's own checks having passed - a learner cannot
 * skip ahead of a step they have not actually completed, which is the point
 * of a guided walkthrough.
 *
 * Standards pills are purely descriptive metadata authored per challenge in
 * infrastructure/config/challenges.ts - nothing here derives behaviour from
 * them, so a challenge with none (Level 1 has no curriculum mapping defined
 * yet) simply renders without the row.
 */
export function ChallengeInstructionsPanel({
  step,
  standards,
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

      {standards && (
        <div className="space-y-1.5 border-b border-border/60 pb-3">
          <div className="flex flex-wrap gap-1.5">
            <span className={PILL_CLASS} title={standards.capsSubject}>
              CAPS: {standards.capsPhase}
            </span>
            {standards.csta.map((code) => (
              <span key={code} className={PILL_CLASS} title="CSTA K-12 Computer Science Standard">
                CSTA {code}
              </span>
            ))}
            <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              <Rocket className="h-2.5 w-2.5" />
              NASA JPL
            </span>
          </div>
          <p className="text-xs italic leading-relaxed text-muted-foreground">{standards.nasaJplContext}</p>
        </div>
      )}

      <p className="text-sm leading-relaxed text-muted-foreground">{step.instructions}</p>

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
