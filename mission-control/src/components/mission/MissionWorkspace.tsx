'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import { useLearner } from '@/contexts/LearnerContext';
import { validateMission } from '@/infrastructure/validation/schemas';
import { generateRandomMissionName } from '@/core/domain/services/missionNameGenerator';
import { findCrash } from '@/core/domain/safety/crashCheck';
import { findSlope } from '@/core/domain/safety/slopeCheck';
import { EditorPanel, type EditorMode } from '@/components/mission/EditorPanel';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { MissionSubmitBar } from '@/components/mission/MissionSubmitBar';
import { DriveFooter } from '@/components/mission/DriveFooter';
import { MissionSentDialog } from '@/components/mission/MissionSentDialog';
import { PhoneWorkspace } from '@/components/mission/PhoneWorkspace';
import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { usePhoneLayout } from '@/hooks/useIsPhoneLayout';
import { useYardLayout } from '@/hooks/useYardLayout';
import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import type { CommandSource, SimulationCommand } from '@/lib/roverBlockly';
import { resolveYardId } from '@/infrastructure/config/yard';
import { carryBlocksToPython, showBlocksAsPython } from '@/infrastructure/browser/pythonDraft';

/**
 * The code of the line the simulator is running, for the phone's one-line
 * strip while the keyboard is up. Python only: a block has no line of its
 * own to quote, and its highlight on the canvas already says which it is.
 */
function runningLineText(code: string, source: CommandSource | null): string | null {
  if (!source?.fromLine) return null;
  return code.split('\n')[source.fromLine - 1]?.trim() || null;
}

export function MissionWorkspace() {
  const { learnerEmail, openEmailPrompt, showEmailPrompt } = useLearner();
  const searchParams = useSearchParams();
  // The yard this site's missions go to, and its layout (AB#468): what the
  // simulator drives in here, so a run is judged against the rocks and slopes
  // of the yard it will run in.
  const yardId = resolveYardId();
  const { layout: yardLayout } = useYardLayout(yardId);
  const initialMode = (searchParams.get('mode') as EditorMode) || 'manual';
  const initialCode = searchParams.get('code') ?? '';
  const remixFromId = searchParams.get('remixFrom') ?? '';

  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(initialMode);
  const [currentCode, setCurrentCode] = useState(initialCode);
  const [blocklyState, setBlocklyState] = useState<string | null>(null);
  /**
   * The exact code the simulator last ran, or null if it has not run.
   *
   * The code itself rather than a boolean, because the useful question is not
   * "has anything been simulated" but "has THIS been simulated". A learner who
   * runs a mission, sees it work, then adds four more blocks has not watched
   * what they are about to submit - and a boolean would happily tell them they
   * had. Compared against currentCode at render time, so any edit takes the
   * tick away on the next keystroke and putting it back restores it.
   */
  const [simulatedCode, setSimulatedCode] = useState<string | null>(null);
  /**
   * The exact code the learner has WATCHED to the end, which is what Send
   * waits for and what "You have watched it" checks. simulatedCode is set the
   * moment Run is pressed, and pressing Run is not watching: with Run and Send
   * on the same button on a phone, a double tap would otherwise launch a
   * mission nobody had seen. Same code-not-boolean reasoning as above.
   */
  const [watchedCode, setWatchedCode] = useState<string | null>(null);
  /**
   * The active editor's own Run, registered by the editor. The phone's top
   * bar calls it, so there is one Run per editor however many buttons lead
   * to it (the editors hide their own button on a phone).
   */
  const runEditorRef = useRef<(() => void) | null>(null);
  const registerRun = useCallback((run: (() => void) | null) => {
    runEditorRef.current = run;
  }, []);
  /** The part of the program the simulator's playhead is on (AB#450). */
  const [runningSource, setRunningSource] = useState<CommandSource | null>(null);
  /**
   * Only while the editor still holds the program that was run. Once the
   * learner edits, the block ids and line numbers describe code that is no
   * longer there, and lighting up line 4 of a different program is a lie.
   * Derived rather than cleared in an effect so no edit path can forget it.
   */
  const highlight = simulatedCode !== null && simulatedCode === currentCode ? runningSource : null;
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [missionSentOpen, setMissionSentOpen] = useState(false);
  /** The phone layout's launch view. Owned here so a successful send can close it. */
  const [launchOpen, setLaunchOpen] = useState(false);
  /** A run is playing out in the simulator now: the phone's Run reads Stop. */
  const [simRunning, setSimRunning] = useState(false);
  /** Bumped by Stop, to pause the simulator where the rover is. */
  const [pauseVersion, setPauseVersion] = useState(0);
  /** How many runs have been watched to the end: the phone opens its launch view on each. */
  const [runsEnded, setRunsEnded] = useState(0);
  // null on the server and during hydration: see usePhoneLayout for why
  // neither layout renders until this is known.
  const phoneLayout = usePhoneLayout();
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

  // Load mission from remixFrom parameter (for cross-device remix via email)
  useEffect(() => {
    if (remixFromId) {
      const loadRemixMission = async () => {
        try {
          const repository = browserMissionRepository();
          const mission = await repository.findById(remixFromId);
          if (mission) {
            if (mission.blocklyState) {
              localStorage.setItem('roverWorkspace', mission.blocklyState);
              setEditorMode('blockly');
            } else {
              localStorage.setItem('roverWorkspace', '');
              localStorage.setItem('rover_monaco_code', mission.code);
              setEditorMode('code');
            }
            setCurrentCode(mission.code);
          }
        } catch (err) {
          console.error('Failed to load mission for remix:', err);
        }
      };
      void loadRemixMission();
    }
  }, [remixFromId]);

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

  // Run the commands through the client-side physics model and play the
  // trajectory in the simulator.
  const runSimulation = (commands: SimulationCommand[]) => {
    setError(null);
    const simulated = simulateCommands(commands, yardLayout);
    setTrajectory(simulated);
    setIsPlaying(true);
    setSimulatedCode(currentCode);
  };

  // Switching editor mode starts a clean simulator: clear the previous run's
  // trajectory so, e.g., Manual starts from an empty canvas.
  const handleEditorModeChange = useCallback((mode: EditorMode) => {
    if (mode === 'code' && editorMode === 'blockly') carryBlocksToPython(blocklyCode);
    setEditorMode(mode);
    setTrajectory([]);
    setIsPlaying(false);
    setError(null);
    // The cleared canvas is no longer a run of anything, so the submit gate
    // closes with it.
    setSimulatedCode(null);
    setWatchedCode(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [editorMode, blocklyCode]);

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
      showBlocksAsPython(blocklyCode);
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
    setSimulatedCode(null);
    setWatchedCode(null);
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
        yardId,
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
      setLaunchOpen(false);
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

  // Not "has a run happened" but "has THIS been watched" - see watchedCode.
  const hasRunSimulation = watchedCode !== null && watchedCode === currentCode;
  // What that watched run hit (AB#466). Only once it has been watched: before
  // then the trajectory may be an older program's, and there is nothing yet
  // that the learner has seen happen.
  const crash = useMemo(
    () => (hasRunSimulation ? findCrash(trajectory) : undefined),
    [hasRunSimulation, trajectory],
  );
  // And what ground it climbs (AB#468), on the same terms.
  const slope = useMemo(
    () => (hasRunSimulation ? findSlope(trajectory) : undefined),
    [hasRunSimulation, trajectory],
  );

  const editorPanel = (
    <EditorPanel
      editorMode={editorMode}
      onEditorModeChange={handleEditorModeChange}
      error={error}
      onManualTrajectory={handleManualTrajectory}
      manualResetVersion={manualResetVersion}
      yard={yardLayout}
      onGenerateCommands={runSimulation}
      onCodeChange={setCurrentCode}
      onBlocklyCode={setBlocklyCode}
      blocklyCode={blocklyCode}
      onShowAsPython={handleShowAsPython}
      onBlocklyStateChange={setBlocklyState}
      highlight={highlight}
      onRegisterRun={registerRun}
    />
  );

  // Drive mode is excluded: it has no code to send.
  const submitBar =
    editorMode === 'manual' ? undefined : (
      <MissionSubmitBar
        missionName={missionName}
        onMissionNameChange={setMissionName}
        onSubmit={handleSubmitToQueue}
        submitting={submitting}
        submitSuccess={submitSuccess}
        currentCode={currentCode}
        hasRunSimulation={hasRunSimulation}
        crash={crash}
        slope={slope}
      />
    );

  const simulatorProps = {
    yardId,
    trajectory,
    isPlaying,
    onReset: handleResetSimulation,
    editorMode,
    resetVersion: manualResetVersion,
    onSourceChange: setRunningSource,
    // Records the code that was RUN, not whatever is in the editor now: an
    // edit made while the rover was still moving has not been watched.
    onFinished: () => {
      setWatchedCode(simulatedCode);
      setRunsEnded((ended) => ended + 1);
    },
    onRunningChange: setSimRunning,
    pauseVersion,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {phoneLayout === null ? (
        // What the server sends. Neutral at every size, so a phone never
        // paints the desktop layout before the phone one replaces it.
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          Loading workspace...
        </div>
      ) : phoneLayout ? (
        <PhoneWorkspace
          editor={editorPanel}
          // Bare: the strip is the frame, and its controls overlay the arena
          // as they do in the run player.
          simulator={<RoverSimulator {...simulatorProps} bare />}
          submitBar={submitBar}
          onRun={() => runEditorRef.current?.()}
          running={simRunning}
          onStop={() => setPauseVersion((version) => version + 1)}
          runEnded={runsEnded}
          editorKind={editorMode === 'code' ? 'code' : 'blocks'}
          launchOpen={launchOpen}
          onLaunchOpenChange={setLaunchOpen}
          runningText={runningLineText(currentCode, highlight)}
        />
      ) : (
        // No divider. It traded width between the editor and the simulator,
        // and the yard is stretched to fill whatever it is given, so every
        // drag reshaped the rocks: from 0.6 to 1.6 times the real yard's
        // width for its depth. The simulator's column is sized from the
        // yard's real shape instead (.buildSim) and the editor has the rest.
        //
        // Name, checks and Send are a card of their own, placed by the grid
        // (globals.css): under the editor on a laptop, beside the simulator on
        // a tablet. Under the simulator they took 116px of its height, and a
        // yard kept to its real shape is as wide as it is tall, so they cost
        // it width too: the simulator had 40% of the page and the editor 60%.
        // Drive fills the same card with its reset, so nothing moves when the
        // mode changes.
        <div className="workspaceSplitGrid">
          <div className="buildEditor min-h-0 min-w-0">{editorPanel}</div>
          <SimulationPanel {...simulatorProps} />
          <div
            className="buildFooter panel @container min-w-0 overflow-hidden border border-border/60 bg-card/40 clay"
            data-build-footer=""
          >
            {submitBar ?? <DriveFooter onResetPosition={handleResetSimulation} />}
          </div>
        </div>
      )}

      <MissionSentDialog
        open={missionSentOpen}
        onClose={() => setMissionSentOpen(false)}
        email={learnerEmail}
      />
    </div>
  );
}
