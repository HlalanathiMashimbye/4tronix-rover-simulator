'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Lightbulb, PartyPopper } from 'lucide-react';
import type { ChallengeCheckSpec, ChallengeStep } from '@/core/domain/entities/Challenge';
import { describeCheck } from './describeCheck';
import { pillClass } from './pill';

interface ChallengeInstructionsPanelProps {
  step: ChallengeStep;
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
  /** The learner's answer to a Predict step, once given, or null. */
  prediction?: string | null;
  /** Per check, what is still missing after the last run, or null (explainOpenCheck, AB#448). */
  explanations?: (string | null)[];
  onPredict?: (option: string) => void;
}

/**
 * Top banner: step dots, the current step's title and instructions, its
 * checklist, and Back/Next. Next is gated on the step's own checks having
 * passed - a learner cannot skip ahead of a step they have not actually
 * completed.
 *
 * THE CHECKLIST IS ON THE PANEL, NOT BEHIND THE BULB. It used to sit in the
 * hint popover, so the one piece of feedback that tells a child what Next is
 * waiting for was a tap away - and the button that opened it was an icon with
 * only a `title`, which has no accessible name and does not exist on touch.
 * Ticks turning green as the child works are the feedback loop; hints, which
 * should be asked for, stay behind the button.
 *
 * This banner used to carry CAPS/CSTA curriculum pills. They are gone because
 * nobody on the team can vouch for the mapping - see
 * infrastructure/config/challenges.ts.
 */
export function ChallengeInstructionsPanel({
  step,
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
  prediction = null,
  explanations = [],
  onPredict,
}: ChallengeInstructionsPanelProps) {
  const [hintOpen, setHintOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const hasHints = Boolean(step.hints && step.hints.length > 0);
  const doneCount = results.filter(Boolean).length;

  return (
    <div className={`relative shrink-0 rounded-3xl border-x-2 border-t-2 border-b-4 p-4 ${
      allStepChecksPass
        ? 'animate-step-celebrate'
        : 'border-kid-panel-edge bg-kid-panel'
    }`}>
      {/* Collapsed header — always visible */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <StepDots stepIndex={stepIndex} totalSteps={totalSteps} />
          <h2 className="mt-1.5 font-display text-xl font-bold text-foreground md:text-2xl">{step.title}</h2>
          {minimized && (
            <p className="mt-1 text-sm font-semibold text-kid-muted-text">
              {doneCount}/{checks.length} checks done
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMinimized(!minimized)}
          aria-expanded={!minimized}
          aria-label={minimized ? 'Expand instructions' : 'Minimise instructions'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-kid-panel-edge text-foreground active:scale-95"
        >
          {minimized ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
        </button>
      </div>

      {/* Expanded body */}
      {!minimized && (
        <div className="mt-3 flex max-h-[40vh] flex-col gap-3 overflow-y-auto md:max-h-none">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line text-base leading-relaxed text-foreground">{step.instructions}</p>

              {step.prediction ? (
                <div className="mt-3">
                  <p id="prediction-question" className="font-display text-base font-bold text-foreground">
                    {step.prediction.question}
                  </p>
                  <div role="group" aria-labelledby="prediction-question" className="mt-2 flex flex-wrap gap-2">
                    {step.prediction.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={prediction === option}
                        onClick={() => onPredict?.(option)}
                        className={pillClass(prediction === option ? 'blue' : 'plain')}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  {prediction && (
                    <p className="mt-2 text-sm font-bold text-kid-blue-text" role="status">
                      Got it! Press Next, then run the code to find out.
                    </p>
                  )}
                </div>
              ) : (
                prediction && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-kid-orange/20 px-3 py-1 text-sm font-bold text-foreground">
                    Your guess: {prediction}
                  </p>
                )
              )}

              <ul aria-label="Mission checklist" className="mt-3 flex flex-wrap gap-2">
                {checks.map((check, index) => {
                  const done = results[index] ?? false;
                  return (
                    <li
                      key={index}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${
                        done
                          ? 'bg-kid-green/15 text-kid-green-text'
                          : 'border-2 border-dashed border-kid-panel-edge text-kid-muted-text'
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0" aria-hidden="true" />
                      )}
                      {describeCheck(check)}
                      <span className="sr-only">{done ? ' - done' : ' - not done yet'}</span>
                    </li>
                  );
                })}
              </ul>

              {explanations.some(Boolean) && (
                <ul aria-live="polite" aria-label="Still to do" className="mt-2 space-y-1">
                  {explanations.map((text, index) =>
                    text ? (
                      <li key={index} className="flex items-start gap-2 text-sm font-semibold text-kid-orange-text">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        {text}
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
              {hasHints && (
                <button
                  type="button"
                  onClick={() => setHintOpen(!hintOpen)}
                  aria-expanded={hintOpen}
                  aria-controls="challenge-hints"
                  className={pillClass('orange')}
                >
                  <Lightbulb className="h-5 w-5" aria-hidden="true" />
                  Hint
                </button>
              )}

              <button type="button" onClick={onBack} disabled={!canGoBack} className={pillClass('plain')}>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                Back
              </button>
              {isFinalStep ? (
                <button
                  type="button"
                  onClick={onFinish}
                  disabled={!allStepChecksPass || finishing}
                  className={pillClass('green')}
                >
                  <PartyPopper className="h-5 w-5" aria-hidden="true" />
                  {finishing ? 'Finishing...' : finishLabel}
                </button>
              ) : (
                <button type="button" onClick={onNext} disabled={!canGoNext} className={pillClass('blue')}>
                  Next
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {hasHints && hintOpen && (
            <div
              id="challenge-hints"
              className="rounded-2xl border-x-2 border-t-2 border-b-4 border-kid-orange-edge p-4"
            >
              <p className="font-display text-base font-bold text-kid-orange-text">Hints</p>
              <ul className="mt-2 space-y-2 text-sm text-foreground">
                {step.hints!.map((hint, i) => (
                  <li key={i} className="flex gap-2">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-kid-orange-text" aria-hidden="true" />
                    {hint}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Navigation stays visible when minimized */}
      {minimized && (
        <div className="mt-3 flex flex-wrap gap-2">
          {hasHints && (
            <button
              type="button"
              onClick={() => { setMinimized(false); setHintOpen(true); }}
              className={pillClass('orange')}
            >
              <Lightbulb className="h-5 w-5" aria-hidden="true" />
              Hint
            </button>
          )}
          <button type="button" onClick={onBack} disabled={!canGoBack} className={pillClass('plain')}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Back
          </button>
          {isFinalStep ? (
            <button
              type="button"
              onClick={onFinish}
              disabled={!allStepChecksPass || finishing}
              className={pillClass('green')}
            >
              <PartyPopper className="h-5 w-5" aria-hidden="true" />
              {finishing ? 'Finishing...' : finishLabel}
            </button>
          ) : (
            <button type="button" onClick={onNext} disabled={!canGoNext} className={pillClass('blue')}>
              Next
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Progress as chunks rather than a sentence: a row of pills, done ones green
 * and the current one blue and wider. The "Step 2 of 4" text is kept for
 * screen readers, which cannot count dots.
 */
function StepDots({ stepIndex, totalSteps }: { stepIndex: number; totalSteps: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="sr-only">
        Step {stepIndex + 1} of {totalSteps}
      </span>
      {Array.from({ length: totalSteps }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-2.5 rounded-full transition-[width] ${
            i < stepIndex ? 'w-6 bg-kid-green' : i === stepIndex ? 'w-10 bg-kid-blue' : 'w-6 bg-kid-panel-edge'
          }`}
        />
      ))}
    </div>
  );
}
