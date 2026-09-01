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
    case 'blockly-block-present':
      return `Use the "${spec.blockType}" block`;
    case 'blockly-shape':
      return `Combine: ${spec.requires.join(' + ')}`;
    case 'trajectory-outcome':
      return `Rover ${spec.outcome.replace('-', ' ')}`;
  }
}

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

      {hints && hints.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <button
            onClick={() => setHintOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-primary"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {hintOpen ? 'Hide hint' : 'Stuck? Show hint'}
          </button>
          {hintOpen && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {hints.map((hint, i) => (
                <li key={i}>{hint}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isFinalStep && (
        <div className="mt-auto border-t border-border/60 pt-3">
          <button
            onClick={onFinish}
            disabled={!allStepChecksPass || finishing}
            className="clay clay-press flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-mars px-3 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <PartyPopper className="h-4 w-4" />
            {finishing ? 'Finishing…' : finishLabel}
          </button>
        </div>
      )}
    </div>
  );
}
