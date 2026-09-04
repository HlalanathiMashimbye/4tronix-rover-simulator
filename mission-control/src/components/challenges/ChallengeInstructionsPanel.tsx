'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Lightbulb, PartyPopper, Rocket } from 'lucide-react';
import type { ChallengeCheckSpec, ChallengeStandards, ChallengeStep } from '@/core/domain/entities/Challenge';

interface ChallengeInstructionsPanelProps {
  step: ChallengeStep;
  standards?: ChallengeStandards;
  stepIndex: number;
  totalSteps: number;
  canGoBack: boolean;
  canGoNext: boolean;
  isFinalStep: boolean;
  allStepChecksPass: boolean;
  checks: ChallengeCheckSpec[];
  results: boolean[];
  finishLabel: string;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
  finishing?: boolean;
}

const PILL_CLASS =
  'rounded-full border border-border/60 bg-secondary/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground';

function describeCheck(spec: ChallengeCheckSpec): string {
  switch (spec.kind) {
    case 'search-query':
      return spec.matches ? `Search for "${spec.matches}"` : 'Type something into the search box';
    case 'search-filter':
      return `Set the filter to "${spec.filterKey}"`;
    case 'load-more':
      return 'Load another page of missions';
    case 'trajectory-outcome':
      return `Rover ${spec.outcome.replace('-', ' ')}`;
    case 'code-contains':
      return CODE_CONTAINS_LABELS[spec.pattern] ?? 'Use the right block';
  }
}

const CODE_CONTAINS_LABELS: Record<string, string> = {
  'for _ in range(': 'Use a Repeat block',
  'rover.setServo(0,': 'Use the Point Mast block',
  'rover.getDistance()': 'Use the Read Distance block',
};

/**
 * Top banner: the current step's title and instructions, curriculum-alignment pills,
 * a bulb icon for hints/checks (mobile-friendly popover), and Back/Next buttons.
 * Next is gated on the step's own checks having passed - a learner cannot
 * skip ahead of a step they have not actually completed.
 */
export function ChallengeInstructionsPanel({
  step,
  standards,
  stepIndex,
  totalSteps,
  canGoBack,
  canGoNext,
  isFinalStep,
  allStepChecksPass,
  checks,
  results,
  finishLabel,
  onBack,
  onNext,
  onFinish,
  finishing,
}: ChallengeInstructionsPanelProps) {
  const [hintOpen, setHintOpen] = useState(false);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (hintRef.current && !hintRef.current.contains(event.target as Node)) {
        setHintOpen(false);
      }
    }

    if (hintOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [hintOpen]);
  return (
    <div className="panel flex flex-col gap-3 overflow-y-auto border border-border/60 bg-card/40 p-4 clay shrink-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Step {stepIndex + 1} of {totalSteps}
          </p>
          <h2 className="font-display text-lg font-bold text-foreground">{step.title}</h2>

          {standards && (
            <div className="mt-3 space-y-1.5 border-b border-border/60 pb-3">
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
        </div>

        <div className="flex gap-2 md:flex-col md:shrink-0">
          <div className="relative" ref={hintRef}>
            <button
              onClick={() => setHintOpen(!hintOpen)}
              className="clay-press flex items-center justify-center rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-xs font-semibold text-foreground hover:bg-card/70 md:w-24"
              title="View target checks and hints"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
            {hintOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border/60 bg-card p-4 shadow-lg">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      Target checks
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {checks.map((check, index) => {
                        const done = results[index] ?? false;
                        return (
                          <li key={index} className="flex items-start gap-2 text-sm">
                            {done ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-buzz" />
                            ) : (
                              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className={done ? 'text-foreground' : 'text-muted-foreground'}>
                              {describeCheck(check)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {step.hints && step.hints.length > 0 && (
                    <div className="border-t border-border/60 pt-3">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Hints
                      </p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {step.hints.map((hint, i) => (
                          <li key={i}>• {hint}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="clay-press flex items-center justify-center gap-1 rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-xs font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40 md:w-24"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          {isFinalStep ? (
            <button
              onClick={onFinish}
              disabled={!allStepChecksPass || finishing}
              className="clay clay-press flex items-center justify-center gap-1 rounded-xl bg-gradient-mars px-3 py-2 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 md:w-28"
            >
              <PartyPopper className="h-4 w-4" />
              {finishing ? 'Finishing…' : finishLabel}
            </button>
          ) : (
            <button
              onClick={onNext}
              disabled={!canGoNext}
              className="clay clay-press flex items-center justify-center gap-1 rounded-xl bg-gradient-mars px-3 py-2 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 md:w-24"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
