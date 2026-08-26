'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { RoverState } from '@/lib/rover-physics';
import { getLearnerID } from '@/lib/getLearnerID';
import { useLearner } from '@/contexts/LearnerContext';
import { validateMission } from '@/infrastructure/validation/schemas';
import { generateRandomMissionName } from '@/lib/missionNameGenerator';
import { EditorPanel, type EditorMode } from '@/components/mission/EditorPanel';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { MissionSubmitBar } from '@/components/mission/MissionSubmitBar';
import { MissionSentDialog } from '@/components/mission/MissionSentDialog';
import { SplitPane } from '@/components/ui/SplitPane';
import { simulateCommands } from '@/lib/simulateCommands';
import { resolveYardId } from '@/infrastructure/config/yard';

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
const SPLIT_DEFAULT = 60;

export function MissionWorkspace() {
  const { learnerEmail, openEmailPrompt, showEmailPrompt } = useLearner();
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as EditorMode) || 'manual';
  const initialCode = searchParams.get('code') ?? '';

  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(initialMode);
  const [currentCode, setCurrentCode] = useState(initialCode);
  const [blocklyState, setBlocklyState] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [missionSentOpen, setMissionSentOpen] = useState(false);
  // True between opening the email prompt and the learner answering it either
  // way. A ref, not state: nothing renders from it, and it must be readable by
  // the effect below in the same tick the prompt closes.
  const awaitingEmailChoiceRef = useRef(false);
  // A name is generated up front so the learner never faces a blank,
  // unnamed mission — they can only re-roll it, not type their own, so it is
  // always present and always valid.
  const [missionName, setMissionName] = useState(() => generateRandomMissionName());
  const abortControllerRef = useRef<AbortController | null>(null);
  const manualTrajectoryLengthRef = useRef(0);
  const [manualResetVersion, setManualResetVersion] = useState(0);

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

    setSubmitting(true);
    setError(null);
    setSubmitSuccess(false);

    try {
      const learnerId = getLearnerID();
      let sessionId = localStorage.getItem('rover-session-id');
      if (!sessionId) {
        sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('rover-session-id', sessionId);
      }

      const validation = validateMission({
        code: currentCode,
        yardId: resolveYardId(),
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
      setMissionName(generateRandomMissionName());
      // Offer notifications once the mission is in (never on landing), and only
      // if the learner has not already saved an email. The confirmation waits
      // for that answer rather than racing it: the prompt covers the whole
      // screen, so anything shown underneath now is read by nobody.
      if (!learnerEmail) {
        awaitingEmailChoiceRef.current = true;
        openEmailPrompt();
      } else {
        setMissionSentOpen(true);
      }
      setTimeout(() => setSubmitSuccess(false), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit mission');
      console.error('Submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Both Skip and Save close the prompt (LearnerContext.setLearnerEmail clears
  // it too), so watching it close covers either answer with one path. By the
  // time this runs, learnerEmail already holds a just-saved address, which is
  // what lets the dialog promise an email to the right place.
  useEffect(() => {
    if (!showEmailPrompt && awaitingEmailChoiceRef.current) {
      awaitingEmailChoiceRef.current = false;
      setMissionSentOpen(true);
    }
  }, [showEmailPrompt]);

  return (
    <div className="space-y-1.5">
      <SplitPane
        ariaLabel="Resize build and simulator panels"
        defaultSplit={SPLIT_DEFAULT}
        minSplit={SPLIT_MIN}
        maxSplit={SPLIT_MAX}
        left={
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
        }
        right={
          <SimulationPanel
            trajectory={trajectory}
            isPlaying={isPlaying}
            onReset={handleResetSimulation}
            editorMode={editorMode}
            resetVersion={manualResetVersion}
            // Name and launch live under the simulator so the block canvas
            // keeps the full height of its own column. Drive mode is excluded:
            // it has no code to send, and the simulator is on screen in every
            // mode.
            footer={
              editorMode === 'manual' ? undefined : (
                <MissionSubmitBar
                  missionName={missionName}
                  onMissionNameChange={setMissionName}
                  onSubmit={handleSubmitToQueue}
                  submitting={submitting}
                  submitSuccess={submitSuccess}
                  currentCode={currentCode}
                />
              )
            }
          />
        }
      />

      <MissionSentDialog
        open={missionSentOpen}
        onClose={() => setMissionSentOpen(false)}
        email={learnerEmail}
      />
    </div>
  );
}
