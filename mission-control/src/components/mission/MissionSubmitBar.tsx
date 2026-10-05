'use client';

import { useMemo } from 'react';
import { Rocket } from 'lucide-react';
import { MissionNameInput } from '@/components/mission/MissionNameInput';
import { PreFlightChecklist } from '@/components/mission/PreFlightChecklist';
import { runPreFlightChecks } from '@/core/domain/safety/preFlightChecks';
import type { Crash } from '@/core/domain/safety/crashCheck';

/**
 * Checks, name and launch, in the simulator's footer slot.
 *
 * These used to be stacked under the block canvas, where they cost 147px of a
 * workspace locked to the viewport. Under the simulator they cost nothing the
 * editor needs, and now nothing the simulator needs either: the slot is one
 * fixed height in every mode (RoverSimulator's footer), and this fills it in
 * one shape whatever the checks say, so the yard above never changes size
 * (AB#464). Drive mode puts DriveFooter in the same slot.
 *
 * The "Mission sent" news takes the checks' line rather than appearing under
 * the button: appearing would change the height, and MissionSentDialog is the
 * celebration anyway.
 *
 * Sizing responds to the CONTAINER, not the viewport: the split slider can
 * squeeze this column to 320px while the window stays wide. Narrow, the chips
 * drop their words and the button says only "Send".
 */
interface MissionSubmitBarProps {
  missionName: string;
  onMissionNameChange: (name: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitSuccess: boolean;
  currentCode: string;
  /** Whether the simulator has run the code currently in the editor. */
  hasRunSimulation: boolean;
  /** What that run hit, from crashCheck: null for nothing (AB#466). */
  crash?: Crash | null;
}

export function MissionSubmitBar({
  missionName,
  onMissionNameChange,
  onSubmit,
  submitting,
  submitSuccess,
  currentCode,
  hasRunSimulation,
  crash,
}: MissionSubmitBarProps) {
  // A parse of the whole program on every keystroke. Cheap enough to do plainly
  // - it is one pass over the lines - but memoised because Blockly re-reports
  // identical code on any workspace event, drag included.
  const preFlight = useMemo(
    () => runPreFlightChecks(currentCode, { hasRunSimulation, crash }),
    [currentCode, hasRunSimulation, crash],
  );

  const hasCode = currentCode.trim().length > 0;

  return (
    <div className="@container flex h-full flex-col justify-between gap-1.5 border-t border-border/60 pt-1.5">
      <PreFlightChecklist
        result={preFlight}
        started={hasCode}
        message={
          submitSuccess ? (
            <span className="font-bold text-buzz">Mission sent! It is in the queue for the rover to run.</span>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1.5">
        <MissionNameInput value={missionName} onChange={onMissionNameChange} />

        <button
          onClick={onSubmit}
          disabled={submitting || !hasCode || !missionName.trim() || !preFlight.ready}
          // The visible words shorten in a narrow column; the name does not.
          aria-label={submitting ? 'Sending' : 'Send to Mission Control'}
          // The chips and the line above say which check is holding it, but a
          // disabled control with no accessible reason is invisible to a
          // screen reader.
          title={!preFlight.ready && hasCode ? 'Pre-flight checks are not complete yet' : undefined}
          // Green once the checks pass, mission orange until then. The button
          // is disabled for exactly the same condition, so the colour is not a
          // second thing to keep in step - it is the disabled state wearing a
          // visible answer to "is it my turn yet".
          className={`clay clay-press flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 ${
            preFlight.ready ? 'bg-gradient-buzz' : 'bg-gradient-mars'
          }`}
        >
          {submitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" aria-hidden="true" />
              <span className="hidden @min-[24rem]:inline">Send to Mission Control</span>
              <span className="@min-[24rem]:hidden">Send</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
