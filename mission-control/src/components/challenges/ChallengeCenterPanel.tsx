'use client';

import { useState } from 'react';
import { Blocks, Code2 } from 'lucide-react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { MissionFeed } from '@/components/mission-feed/MissionFeed';
import { BlocklyEditor } from '@/components/mission/BlocklyEditor';
import { MonacoCodeEditor } from '@/components/mission/MonacoCodeEditor';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import type { SimulationCommand } from '@/lib/roverBlockly';
import {
  deriveTrajectoryOutcomes,
  type TrajectoryOutcome,
} from '@/core/application/services/ChallengeCheckEvaluator';

interface ChallengeCenterPanelProps {
  challenge: Challenge;
  onLoadMore: () => void;
  onFeedState: (state: { hasMore: boolean }) => void;
  onCodeChange: (code: string) => void;
  onBlocklyStateChange: (state: string) => void;
  onTrajectoryOutcomes: (outcomes: TrajectoryOutcome[]) => void;
}

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
 * 'monaco-sim' reuses MonacoCodeEditor + SimulationPanel - real Python, for
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
}: ChallengeCenterPanelProps) {
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blocksView, setBlocksView] = useState<'blocks' | 'python'>('blocks');
  const [lastGeneratedCode, setLastGeneratedCode] = useState('');

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
    setTrajectory(simulateCommands(commands));
    setIsPlaying(true);
    onTrajectoryOutcomes(deriveTrajectoryOutcomes(commands));
  };

  const handleReset = () => {
    setTrajectory([]);
    setIsPlaying(false);
  };

  const handleCodeChange = (code: string) => {
    setLastGeneratedCode(code);
    onCodeChange(code);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 lg:flex-row">
      <div className="panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border/60 bg-card/40 clay">
        {challenge.workspaceKind === 'blockly-sim' && (
          <div className="flex shrink-0 gap-1.5 border-b border-border/60 p-1.5">
            <button
              onClick={() => setBlocksView('blocks')}
              aria-pressed={blocksView === 'blocks'}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
                blocksView === 'blocks'
                  ? 'bg-gradient-mars text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Blocks className="h-3.5 w-3.5" />
              Blocks
            </button>
            <button
              onClick={() => setBlocksView('python')}
              aria-pressed={blocksView === 'python'}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
                blocksView === 'python'
                  ? 'bg-gradient-mars text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
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
              />
            </div>
          ) : (
            <MonacoCodeEditor onGenerateCommands={handleRun} onCodeChange={handleCodeChange} />
          )}

          {challenge.workspaceKind === 'blockly-sim' && blocksView === 'python' && (
            <pre className="h-full overflow-auto bg-secondary/40 p-3 font-mono text-xs leading-relaxed text-foreground">
              <code>{lastGeneratedCode || '# Add some blocks to see the Python here.'}</code>
            </pre>
          )}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <SimulationPanel
          trajectory={trajectory}
          isPlaying={isPlaying}
          onReset={handleReset}
          editorMode={challenge.workspaceKind === 'blockly-sim' ? 'blockly' : 'code'}
          resetVersion={0}
        />
      </div>
    </div>
  );
}
