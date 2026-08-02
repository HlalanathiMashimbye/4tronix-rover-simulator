'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { RoverState } from '@/lib/rover-physics';
import { getLearnerID } from '@/lib/getLearnerID';
import { useLearner } from '@/contexts/LearnerContext';
import { validateMission } from '@/infrastructure/validation/schemas';
import { EditorPanel, type EditorMode } from '@/components/mission/EditorPanel';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { MissionSubmitBar } from '@/components/mission/MissionSubmitBar';
import { simulateCommands } from '@/lib/simulateCommands';

interface TrajectoryPoint {
  x: number;
  y: number;
  heading: number;
  speedL: number;
  speedR: number;
  servos: Record<string, number>;
}

type SimulationCommand = {
  command: string;
  speed?: number;
  duration?: number;
  degrees?: number;
};

// Bounds of the build/simulator split, as a percentage given to the build
// side. Owned here rather than in EditorPanel so the divider clamps to the
// same range as the values used to size the grid tracks.
const SPLIT_MIN = 35;
const SPLIT_MAX = 75;

export function MissionWorkspace() {
  const { learnerEmail, openEmailPrompt } = useLearner();
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as EditorMode) || 'manual';
  const initialCode = searchParams.get('code') ?? '';

  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(initialMode);
  const [panelSplit, setPanelSplit] = useState(60);
  const [currentCode, setCurrentCode] = useState(initialCode);
  const [blocklyState, setBlocklyState] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [missionName, setMissionName] = useState('');
  const [missionNameError, setMissionNameError] = useState<string | null>(null);
  const [showMissionNameValidation, setShowMissionNameValidation] = useState(false);
  const [isMissionNameValid, setIsMissionNameValid] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const manualTrajectoryLengthRef = useRef(0);
  const [manualResetVersion, setManualResetVersion] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Drives the divider's active styling only. The grid itself is deliberately
  // untransitioned (see .workspaceSplitGrid in globals.css), so there is no
  // easing to suppress while a drag is in flight.
  const [isSplitDragging, setIsSplitDragging] = useState(false);
  // Read synchronously inside pointermove, which must not depend on a React
  // re-render having landed first.
  const draggingRef = useRef(false);

  // Apply CSS variables to the container via DOM to avoid JSX inline styles
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.setProperty('--workspace-left', `${panelSplit}fr`);
    containerRef.current.style.setProperty('--workspace-right', `${100 - panelSplit}fr`);
  }, [panelSplit]);

  // Where the pointer went down, and what the split was at that moment.
  // The drag is applied as a delta from these rather than as an absolute
  // cursor-to-percentage mapping: the fr tracks share out the container
  // MINUS the divider and the two gaps, so an absolute mapping lands the
  // handle tens of pixels away from the cursor and it visibly jumps out from
  // under the grab on the first move.
  const dragStartRef = useRef<{ x: number; split: number } | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  // The width the fr tracks actually divide between them. Dividing the drag
  // delta by this (rather than the full container width) is what makes the
  // handle keep pace with the cursor exactly instead of drifting ~2% behind
  // over a long throw.
  const splittableWidth = () => {
    const el = containerRef.current;
    if (!el) return 0;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const dividerW = dividerRef.current?.getBoundingClientRect().width ?? 0;
    return el.getBoundingClientRect().width - dividerW - gap * 2;
  };

  const handleDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Pointer capture keeps the drag alive when the cursor outruns the
    // 11px divider, which it does constantly on a fast throw.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { x: event.clientX, split: panelSplit };
    draggingRef.current = true;
    setIsSplitDragging(true);
  };

  const handleDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!draggingRef.current || !start) return;
    const width = splittableWidth();
    if (width <= 0) return;
    // Deliberately not rounded to whole percent: at ~1230px of splittable
    // width, 1% is over 12px, so rounding would make the panel edge climb in
    // visible 12px stairs instead of following the cursor.
    const deltaPct = ((event.clientX - start.x) / width) * 100;
    setPanelSplit(
      Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, start.split + deltaPct))
    );
  };

  const endDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingRef.current = false;
    dragStartRef.current = null;
    // Settle on a whole percent so the label and the slider agree with what
    // was just dragged to.
    setPanelSplit((current) => Math.round(current));
    setIsSplitDragging(false);
  };

  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    setPanelSplit((current) =>
      Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, current + delta))
    );
  };

  // Run the commands through the client-side physics model and play the
  // trajectory in the simulator.
  const runSimulation = (commands: SimulationCommand[]) => {
    setError(null);
    const simulated = simulateCommands(commands);
    setTrajectory(simulated);
    setIsPlaying(true);
  };

  // Switching editor mode starts a clean simulator: clear the previous run's
  // trajectory so, e.g., Manual starts from an empty canvas.
  const handleEditorModeChange = useCallback((mode: EditorMode) => {
    setEditorMode(mode);
    setTrajectory([]);
    setIsPlaying(false);
    setError(null);
    manualTrajectoryLengthRef.current = 0;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleManualTrajectory = useCallback((realtimeTrajectory: RoverState[]) => {
    const converted: TrajectoryPoint[] = realtimeTrajectory.map((state) => ({
      x: state.x,
      y: state.y,
      heading: state.heading,
      speedL: state.speedL,
      speedR: state.speedR,
      servos: {
        '9': state.servos[9],
        '15': state.servos[15],
        '11': state.servos[11],
        '13': state.servos[13],
      },
    }));
    setTrajectory((previousTrajectory) => {
      const startIndex = manualTrajectoryLengthRef.current;
      if (converted.length <= startIndex) {
        return previousTrajectory;
      }

      manualTrajectoryLengthRef.current = converted.length;
      return [...previousTrajectory, ...converted.slice(startIndex)];
    });
    setIsPlaying(true);
  }, []);

  const handleResetSimulation = useCallback(() => {
    if (editorMode === 'manual') {
      // Clear the drawn path and park the rover back at the start. The reset
      // version bump tells ManualControlRealtime to reset its physics too, so
      // the next tap drives from the centre again.
      manualTrajectoryLengthRef.current = 0;
      setTrajectory([]);
      setManualResetVersion((version) => version + 1);
      setIsPlaying(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setTrajectory([]);
    setIsPlaying(false);
    manualTrajectoryLengthRef.current = 0;
  }, [editorMode]);

  const handleSubmitToQueue = async () => {
    if (!currentCode.trim()) {
      setError('Please write some code first!');
      return;
    }

    if (!isMissionNameValid) {
      setError('Mission name is required! Please enter or generate a name.');
      setMissionNameError('Please enter mission name.');
      setShowMissionNameValidation(true);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(false);
    setShowMissionNameValidation(false);

    try {
      const learnerId = getLearnerID();
      let sessionId = localStorage.getItem('rover-session-id');
      if (!sessionId) {
        sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('rover-session-id', sessionId);
      }

      const validation = validateMission({
        code: currentCode,
        yardId: 'uct-rover-1',
        learnerId,
        sessionId,
        // Stamp the email when the learner has provided one so this mission
        // shows up in their cross-device history.
        ...(learnerEmail ? { learnerEmail } : {}),
        ...(editorMode === 'blockly' && blocklyState ? { blocklyState } : {}),
        name: missionName,
      });

      if (!validation.success) {
        setError(validation.errors?.join(' | ') || 'Validation failed');
        return;
      }

      const response = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validation.data),
      });
      const result = await response.json();

      if (!response.ok || !result.success || !result.mission) {
        throw new Error(result.error || 'Failed to submit mission');
      }

      localStorage.setItem('rover-latest-mission-id', result.mission.id);

      setSubmitSuccess(true);
      setMissionName('');
      // Offer notifications once the mission is in (never on landing), and only
      // if the learner has not already saved an email.
      if (!learnerEmail) openEmailPrompt();
      setTimeout(() => setSubmitSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit mission');
      console.error('Submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="workspaceSplitGrid" ref={containerRef}>
        <EditorPanel
          editorMode={editorMode}
          onEditorModeChange={handleEditorModeChange}
          error={error}
          onManualTrajectory={handleManualTrajectory}
          onResetSimulation={handleResetSimulation}
          manualResetVersion={manualResetVersion}
          onGenerateCommands={runSimulation}
          onCodeChange={setCurrentCode}
          onBlocklyStateChange={setBlocklyState}
        />

        {/* Grab-anywhere divider: the mouse control for the split. Sits under
          the cursor and moves with it exactly. */}
        <div
          ref={dividerRef}
          className="workspaceSplitDivider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize build and simulator panels"
          aria-valuenow={Math.round(panelSplit)}
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={SPLIT_MAX}
          tabIndex={0}
          data-dragging={isSplitDragging ? 'true' : 'false'}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={endDividerDrag}
          onPointerCancel={endDividerDrag}
          onKeyDown={handleDividerKeyDown}
          onDoubleClick={() => setPanelSplit(60)}
          title="Drag to resize · double-click to reset"
        />

        <SimulationPanel
          trajectory={trajectory}
          isPlaying={isPlaying}
          onReset={handleResetSimulation}
          editorMode={editorMode}
          resetVersion={manualResetVersion}
          // Name and launch live under the simulator so the block canvas keeps
          // the full height of its own column. Drive mode is excluded: it has
          // no code to send, and the simulator is on screen in every mode.
          footer={
            editorMode === 'manual' ? undefined : (
              <MissionSubmitBar
                missionName={missionName}
                onMissionNameChange={setMissionName}
                missionNameError={missionNameError}
                onMissionNameError={setMissionNameError}
                showMissionNameValidation={showMissionNameValidation}
                onMissionNameValidationChange={setIsMissionNameValid}
                onSubmit={handleSubmitToQueue}
                submitting={submitting}
                submitSuccess={submitSuccess}
                currentCode={currentCode}
                isMissionNameValid={isMissionNameValid}
              />
            )
          }
        />
      </div>
    </div>
  );
}
