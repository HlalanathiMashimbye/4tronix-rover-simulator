'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Blocks, Code2, Eye, Target } from 'lucide-react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { MissionFeed } from '@/components/mission-feed/MissionFeed';
import { BlocklyEditor } from '@/components/mission/BlocklyEditor';
import { loadPythonEditor } from '@/components/mission/loadPythonEditor';
import { pillClass } from './pill';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { useYardLayout } from '@/hooks/useYardLayout';
import { crashFrame, simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import type { SimulationCommand } from '@/lib/roverBlockly';
import {
  deriveTrajectoryOutcomes,
  type TrajectoryOutcome,
} from '@/core/application/services/ChallengeCheckEvaluator';
import type { TargetGeometry, TargetPoint } from '@/core/domain/services/challengeTarget';

// The same lazily loaded CodeMirror editor Create Mission uses (see
// EditorPanel), so Level 3 types into exactly the editor the learner will
// meet when they send the mission for real.
const PythonCodeEditor = dynamic(() => loadPythonEditor().then((m) => m.PythonCodeEditor), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-xl border border-border bg-[#1e1e1e]" />,
});

interface ChallengeCenterPanelProps {
  challenge: Challenge;
  onLoadMore: () => void;
  onFeedState: (state: { hasMore: boolean }) => void;
  onCodeChange: (code: string) => void;
  onBlocklyStateChange: (state: string) => void;
  onTrajectoryOutcomes: (outcomes: TrajectoryOutcome[]) => void;
  /**
   * Each simulated run: the path it drove and whether it hit a rock or a
   * wall, for the target and hazard checks.
   */
  onRun?: (run: { path: TargetPoint[]; crashed: boolean }) => void;
  /** The challenge's target, from challengeTarget's targetGeometry, or null. */
  target?: TargetGeometry | null;
  /** Keep the target's path off the simulator for now (a Predict step is unanswered). */
  holdTarget?: boolean;
}

/** How long "Show target" brings the path back for (AB#447: "about 5 seconds"). */
export const TARGET_PEEK_MS = 5000;

/**
 * The workspace's center panel, branching on the challenge's workspaceKind.
 *
 * 'embedded-platform' renders the REAL mission feed - the same MissionFeed
 * component the home page renders - rather than a lookalike, so "search the
 * real platform" is literally true. Its search box and filter chips live in
 * the navbar above (NavbarSearch/MobileSearch already read from the same
 * SearchContext this page is inside), which is why the instructions panel
 * points the learner up at the bar rather than into this panel.
 *
 * 'blockly-sim' reuses BlocklyEditor + SimulationPanel exactly as /mission
 * does, with a Blocks/Python toggle so a learner can see what their blocks
 * generate without leaving the challenge (the "Show as Python" action tab).
 *
 * 'monaco-sim' reuses PythonCodeEditor + SimulationPanel - real Python, for
 * Level 3, where a learner types out by hand a shape they built from blocks
 * in Level 2.
 *
 * Both code-based branches report the generated Python live (for
 * code-contains checks and the Create Mission handoff) and, on Run, which
 * outcomes the simulated commands actually produced (for trajectory-outcome
 * checks).
 */
export function ChallengeCenterPanel({
  challenge,
  onLoadMore,
  onFeedState,
  onCodeChange,
  onBlocklyStateChange,
  onTrajectoryOutcomes,
  onRun,
  target = null,
  holdTarget = false,
}: ChallengeCenterPanelProps) {
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blocksView, setBlocksView] = useState<'blocks' | 'python'>('blocks');
  const [lastGeneratedCode, setLastGeneratedCode] = useState('');

  /**
   * The target overlay (AB#447): on when the challenge opens, off once the
   * learner starts building, and back for TARGET_PEEK_MS when they ask.
   *
   * "Starts building" is the code changing from whatever the editor first
   * reported, not the first report itself: a PRIMM challenge opens with code
   * already on the canvas, and loading it is not the learner building.
   */
  // The yard the simulator below draws (AB#468), and the one each run is
  // simulated in - the same pairing Create Mission uses. Simulating in the
  // built-in yard while drawing an operator-edited one put the rocks a
  // learner could see somewhere other than the rocks a run crashed into.
  const { layout: yardLayout } = useYardLayout(undefined);

  const firstCode = useRef<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    if (!peeking) return;
    const timer = setTimeout(() => setPeeking(false), TARGET_PEEK_MS);
    return () => clearTimeout(timer);
  }, [peeking]);

  const showPath = target !== null && !holdTarget && (!building || peeking);
  // Memoised: the simulator repaints whenever this object changes.
  const simTarget = useMemo(
    () => (target ? { path: target.path, goal: target.goal, showPath } : null),
    [target, showPath],
  );

  if (challenge.workspaceKind === 'embedded-platform') {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="mx-auto w-full max-w-page pt-1">
          <MobileSearch />
        </div>
        <MissionFeed onLoadMore={onLoadMore} onFeedState={onFeedState} />
      </div>
    );
  }

  const handleRun = (commands: SimulationCommand[]) => {
    const run = simulateCommands(commands, yardLayout);
    setTrajectory(run);
    setIsPlaying(true);
    onTrajectoryOutcomes(deriveTrajectoryOutcomes(commands));
    onRun?.({ path: run.map(({ x, y }) => ({ x, y })), crashed: crashFrame(run) >= 0 });
  };

  const handleReset = () => {
    setTrajectory([]);
    setIsPlaying(false);
  };

  const handleCodeChange = (code: string) => {
    setLastGeneratedCode(code);
    onCodeChange(code);
    if (firstCode.current === null) firstCode.current = code;
    else if (code !== firstCode.current) setBuilding(true);
  };


  return (
    // isolate: Blockly stacks its own parts high (toolbox 70, workspace
    // scrollbars 20), and without a stacking context of its own here they
    // painted over the workspace's "Challenge complete!" overlay (z-10) - the
    // toolbox and scrollbars showed through the blur and cut across the card.
    // Contained, they only compete with each other.
    <div data-testid="challenge-code-workspace" className="isolate flex h-full min-h-0 w-full flex-col gap-2 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel">
        {challenge.workspaceKind === 'blockly-sim' && (
          <div className="flex shrink-0 gap-1.5 border-b-2 border-kid-panel-edge p-1.5">
            <button
              onClick={() => setBlocksView('blocks')}
              aria-pressed={blocksView === 'blocks'}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 font-display text-sm font-bold transition-colors ${
                blocksView === 'blocks'
                  ? 'border-b-4 border-kid-blue-edge bg-kid-blue text-kid-ink'
                  : 'text-kid-muted-text hover:text-foreground'
              }`}
            >
              <Blocks className="h-5 w-5" aria-hidden="true" />
              Blocks
            </button>
            <button
              onClick={() => setBlocksView('python')}
              aria-pressed={blocksView === 'python'}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 font-display text-sm font-bold transition-colors ${
                blocksView === 'python'
                  ? 'border-b-4 border-kid-blue-edge bg-kid-blue text-kid-ink'
                  : 'text-kid-muted-text hover:text-foreground'
              }`}
            >
              <Code2 className="h-5 w-5" aria-hidden="true" />
              Show as Python
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {challenge.workspaceKind === 'blockly-sim' ? (
            <div className={blocksView === 'blocks' ? 'h-full' : 'hidden'}>
              <BlocklyEditor
                onGenerateCommands={handleRun}
                onCodeChange={handleCodeChange}
                onBlocklyStateChange={onBlocklyStateChange}
                storageKey={`challengeWorkspace:${challenge.id}`}
                starterWorkspace={challenge.starterBlocks}
              />
            </div>
          ) : (
            <PythonCodeEditor
              onGenerateCommands={handleRun}
              onCodeChange={handleCodeChange}
              storageKey={`challengeCode:${challenge.id}`}
              starterCode={challenge.starterCode}
            />
          )}

          {challenge.workspaceKind === 'blockly-sim' && blocksView === 'python' && (
            <pre className="h-full overflow-auto bg-secondary/40 p-3 font-mono text-xs leading-relaxed text-foreground">
              <code>{lastGeneratedCode || '# Add some blocks to see the Python here.'}</code>
            </pre>
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {target && challenge.target && !holdTarget && (
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel px-3 py-1.5">
            {showPath ? (
              <p className="flex min-h-11 items-center gap-2 text-sm font-bold text-foreground">
                <Target className="h-5 w-5 shrink-0 text-kid-orange-text" aria-hidden="true" />
                <span>
                  <span className="text-kid-orange-text">Target: </span>
                  {challenge.target.description}
                </span>
              </p>
            ) : (
              <button type="button" onClick={() => setPeeking(true)} className={pillClass('orange')}>
                <Eye className="h-5 w-5" aria-hidden="true" />
                Show target
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <SimulationPanel
            trajectory={trajectory}
            isPlaying={isPlaying}
            onReset={handleReset}
            editorMode={challenge.workspaceKind === 'blockly-sim' ? 'blockly' : 'code'}
            resetVersion={0}
            target={simTarget}
          />
        </div>
      </div>
    </div>
  );
}
