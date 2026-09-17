'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Lightbulb,
  PartyPopper,
} from 'lucide-react';
import type { ChallengeCheckSpec, ChallengeStep } from '@/core/domain/entities/Challenge';

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
}

function describeCheck(spec: ChallengeCheckSpec): string {
  switch (spec.kind) {
    case 'search-query':
      return spec.matches ? `Search for "${spec.matches}"` : 'Type something into the search box';
    case 'search-filter':
      return `Set the filter to "${spec.filterKey}"`;
    case 'load-more':
      return 'Load another page of missions';
    case 'route-visited':
      return ROUTE_LABELS[spec.path] ?? `Open ${spec.path}`;
    case 'mission-created':
      return 'Send a mission to the queue';
    case 'trajectory-outcome':
      return `Rover ${spec.outcome.replace('-', ' ')}`;
    case 'code-contains':
      return CODE_CONTAINS_LABELS[spec.pattern] ?? 'Use the right command';
  }
}

/**
 * A route check reads as the page's NAME in the navigation bar, not its path.
 * '/history' is an implementation detail; "Open History" is the thing the
 * learner is being asked to click. Unknown paths fall back to the raw path so
 * a new check is merely ugly rather than silently mislabelled.
 */
const ROUTE_LABELS: Record<string, string> = {
  '/history': 'Open History',
  '/leaderboard': 'Open Leaderboard',
  '/mission': 'Open Create Mission',
};

/**
 * Blockly and Monaco challenges share these check patterns, so the wording has
 * to fit both - Level 2 drags a Repeat block, Level 3 types the loop out.
 */
const CODE_CONTAINS_LABELS: Record<string, string> = {
  'for _ in range(': 'Repeat the movement in a loop',
  'rover.setServo(0,': 'Point the mast',
};

const EXIT_MS = 200;

/**
 * Slim persistent bar with step navigation, plus a slide-down drawer for
 * instructions, target checks and hints. The drawer overlays the workspace
 * instead of eating its vertical space, so the simulator/editor stays
 * full-height on both desktop and mobile.
 *
 * Plain CSS transitions, not Motion's AnimatePresence - see NotificationModal
 * for the known bug with the exact React 19 / Next 16 / motion combination.
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
}: ChallengeInstructionsPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawerOpen(false);
  }, [stepIndex]);

  useEffect(() => {
    if (drawerOpen) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setDrawerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [drawerOpen]);

  return (
    <div className="relative z-30 shrink-0" ref={panelRef}>
      {/* Slim bar: step counter, title, toggle, navigation */}
      <div className="panel flex items-center gap-2 border border-border/60 bg-card/40 px-3 py-2 clay">
        <p className="shrink-0 text-xs font-bold uppercase tracking-[0.12em] text-primary">
          {stepIndex + 1}/{totalSteps}
        </p>

        <span className="mx-0.5 h-4 w-px shrink-0 bg-border/60" />

        <h2 className="min-w-0 flex-1 truncate font-display text-sm font-bold text-foreground">
          {step.title}
        </h2>

        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className={`clay-press flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
            drawerOpen
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border/60 bg-card/50 text-foreground hover:bg-card/70'
          }`}
        >
          <Lightbulb className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{drawerOpen ? 'Close' : 'Instructions'}</span>
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-200 ${drawerOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="clay-press flex items-center justify-center rounded-xl border border-border/60 bg-card/50 p-1.5 text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {isFinalStep ? (
            <button
              onClick={onFinish}
              disabled={!allStepChecksPass || finishing}
              className="clay clay-press flex items-center gap-1 rounded-xl bg-gradient-mars px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PartyPopper className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{finishing ? 'Finishing…' : finishLabel}</span>
            </button>
          ) : (
            <button
              onClick={onNext}
              disabled={!canGoNext}
              className="clay clay-press flex items-center justify-center rounded-xl bg-gradient-mars p-1.5 text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Slide-down drawer */}
      {mounted && (
        <div
          className={`absolute left-0 right-0 top-full z-20 mt-1 max-h-[min(35vh,240px)] overflow-y-auto rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-xl clay transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
          }`}
        >
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-bold text-foreground">{step.title}</h3>
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                {step.instructions}
              </p>
            </div>

            <div className="border-t border-border/60 pt-2">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Target checks
              </h4>
              <ul className="mt-1.5 space-y-1.5">
                {checks.map((check, index) => {
                  const done = results[index] ?? false;
                  return (
                    <li key={index} className="flex items-start gap-1.5 text-xs">
                      {done ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-buzz" />
                      ) : (
                        <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
              <div className="border-t border-border/60 pt-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Hints
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
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
  );
}
