'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';
import { useLearner } from '@/contexts/LearnerContext';
import { validateMission } from '@/infrastructure/validation/schemas';
import { generateRandomMissionName } from '@/core/domain/services/missionNameGenerator';
import { EditorPanel, type EditorMode } from '@/components/mission/EditorPanel';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { MissionSubmitBar } from '@/components/mission/MissionSubmitBar';
import { MissionSentDialog } from '@/components/mission/MissionSentDialog';
import { SplitPane } from '@/components/ui/SplitPane';
import { simulateCommands } from '@/lib/simulateCommands';
import { resolveYardId } from '@/infrastructure/config/yard';
import { consumeChallengeHandoff } from '@/infrastructure/browser/challengeHandoff';
import { ROVER_WORKSPACE_STORAGE_KEY } from '@/components/mission/BlocklyEditor';
import { Sparkles } from 'lucide-react';

interface TrajectoryPoint {
  x: number;
  y: number;
  heading: number;
  speedL: number;
  speedR: number;
  servos: Record<string, number>;
  hitWall?: boolean;
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
  /**
   * A name is generated so the learner never faces a blank, unnamed mission:
   * they can only re-roll it, not type their own.
   *
   * Generated on mount rather than in useState's initialiser. That initialiser
   * runs during render, which happens on the server too - this is a client
   * component but Next still server-renders the first HTML - so the server
   * picked one name, the browser picked another, and React threw a hydration
   * mismatch on every single load of this page. The name is random by design,
   * so there is no way to make the two agree; the fix is not to render one
   * until the browser is the only thing rendering.
   */
  const [missionName, setMissionName] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMissionName(generateRandomMissionName());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  /** Set when this session arrived via "Finish & Export" from a challenge. */
  const [importedFromChallenge, setImportedFromChallenge] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [manualResetVersion, setManualResetVersion] = useState(0);
  /**
   * The Python the learner's BLOCKS produce, kept apart from currentCode.
   *
   * currentCode is whatever the active editor last reported, and switching to
   * the Python tab immediately overwrites it with that tab's own draft. So the
   * blocks' version has to be held separately or it is lost the moment the
   * learner goes to look at it - which is exactly what they do after building
   * something (AB#413).
   */
  const [blocklyCode, setBlocklyCode] = useState('');

  /**
   * Consume a Progressive Challenges handoff, if one is waiting.
   *
   * Neither editor accepts an "initial state" prop - each loads whatever is
   * under its own localStorage key the moment it mounts, and that is the
   * only way to seed either of them. So this writes the handoff's code under
   * the RIGHT key for its editorMode BEFORE switching editorMode itself,
   * which is what causes that editor to mount in the first place - by
   * construction, the seed lands before there is anything to race.
   */
  useEffect(() => {
    const handoff = consumeChallengeHandoff();
    if (!handoff) return;

    try {
      if (handoff.editorMode === 'blockly' && handoff.blocklyState) {
        localStorage.setItem(ROVER_WORKSPACE_STORAGE_KEY, handoff.blocklyState);
      } else {
        localStorage.setItem('rover_monaco_code', handoff.code);
      }
    } catch {
      // localStorage unavailable - the editor falls back to its own default,
      // but the code/name still make it into the submission below.
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from a sessionStorage handoff; not readable during SSR render, same pattern as the missionName effect above
    setCurrentCode(handoff.code);
    setBlocklyCode(handoff.code);
    if (handoff.blocklyState) setBlocklyState(handoff.blocklyState);
    setEditorMode(handoff.editorMode);
    setImportedFromChallenge({ id: handoff.challengeId, title: handoff.challengeTitle });
  }, []);

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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Take the blocks' Python to the Python tab and show it.
   *
   * Overwrites the draft on purpose. The learner has just asked to see their
   * blocks as code, so anything already sitting there is not what they wanted
   * to look at, and quietly showing them something else would be the bug this
   * replaces.
   */
  const handleShowAsPython = useCallback(() => {
    if (blocklyCode.trim()) {
      localStorage.setItem('rover_monaco_code', blocklyCode);
      setCurrentCode(blocklyCode);
    }
    setEditorMode('code');
  }, [blocklyCode]);

  /**
   * The manual controller owns the whole path; take it as given.
   *
   * This used to treat the child's array as append-only and track a cursor
   * into it, copying across only what was new. That assumption broke the moment
   * the child hit its own cap: past 1000 points it slides a window, so the
   * length stops growing, and "nothing new since the cursor" became true
   * forever. The parent then returned the previous trajectory on every frame
   * and the rover froze on screen while its physics carried on underneath.
   *
   * Driving into a wall was the usual way to notice, because reaching one took
   * long enough to fill the buffer. Reset appeared to fix it only because it
   * zeroed the cursor.
   */
  /**
   * The manual controller owns the whole path; take it as given.
   *
   * Two separate bugs met here. It first tracked a cursor into the child's
   * array, which froze the rover once the child's sliding window stopped the
   * length growing. Replacing that with a full re-map fixed the freeze and
   * introduced a worse problem: mapping a three-thousand-point trail into fresh
   * objects sixty times a second is ~180,000 allocations per second, which
   * drove React into "maximum update depth" and killed the dev server.
   *
   * The child now converts each point once as it happens, so this is a plain
   * assignment of an array it already built.
   */
  const handleManualTrajectory = useCallback((points: TrajectoryPoint[]) => {
    setTrajectory(points);
    setIsPlaying(true);
  }, []);

  const handleResetSimulation = useCallback(() => {
    if (editorMode === 'manual') {
      // Clear the drawn path and park the rover back at the start. The reset
      // version bump tells ManualControlRealtime to reset its physics too, so
      // the next tap drives from the centre again.
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
        ...(importedFromChallenge
          ? { origin: 'challenge' as const, challengeId: importedFromChallenge.id }
          : {}),
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
      {importedFromChallenge && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
          <Sparkles className="h-4 w-4 shrink-0" />
          Imported from Challenge: {importedFromChallenge.title}
        </div>
      )}

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
            onBlocklyCode={setBlocklyCode}
            blocklyCode={blocklyCode}
            onShowAsPython={handleShowAsPython}
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
