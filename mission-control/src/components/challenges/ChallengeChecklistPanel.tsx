'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, Lightbulb, PartyPopper } from 'lucide-react';
import type { ChallengeCheckSpec } from '@/core/domain/entities/Challenge';

/** Plain-English label for a check - presentation only, not domain logic. */
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

/**
 * Friendlier labels for the specific patterns this feature's own content
 * actually uses (see infrastructure/config/challenges.ts) - falls back to a
 * generic label for anything else rather than showing raw Python text.
 */
const CODE_CONTAINS_LABELS: Record<string, string> = {
  'for _ in range(': 'Use a Repeat block',
  'rover.setServo(0,': 'Use the Point Mast block',
  'rover.getDistance()': 'Use the Read Distance block',
};

interface ChallengeChecklistPanelProps {
  checks: ChallengeCheckSpec[];
  results: boolean[];
  hints?: string[];
  isFinalStep: boolean;
  allStepChecksPass: boolean;
  finishLabel: string;
  onFinish: () => void;
  finishing?: boolean;
}

/**
 * Right rail: live-ticking checklist, an optional hint, and the step's exit
 * action. Ticks are driven entirely by `results`, computed every render by
 * the workspace from ChallengeCheckEvaluator - there is nothing to poll here.
 */
export function ChallengeChecklistPanel({
  checks,
  results,
  hints,
  isFinalStep,
  allStepChecksPass,
  finishLabel,
  onFinish,
  finishing,
}: ChallengeChecklistPanelProps) {
  const [hintOpen, setHintOpen] = useState(false);

  return (
    <div className="panel flex h-full w-full flex-col gap-3 overflow-y-auto border border-border/60 bg-card/40 p-3 clay lg:w-72 lg:shrink-0">
      {isFinalStep && (
        <button
          onClick={onFinish}
          disabled={!allStepChecksPass || finishing}
          className="clay clay-press flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-mars px-3 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PartyPopper className="h-4 w-4" />
          {finishing ? 'Finishing…' : finishLabel}
        </button>
      )}
    </div>
  );
}
