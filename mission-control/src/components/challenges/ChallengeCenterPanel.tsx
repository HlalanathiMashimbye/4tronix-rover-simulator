'use client';

import { useState } from 'react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { MissionFeed } from '@/components/mission-feed/MissionFeed';
import { BlocklyEditor } from '@/components/mission/BlocklyEditor';
import { SimulationPanel } from '@/components/mission/SimulationPanel';
import { simulateCommands, type TrajectoryPoint } from '@/lib/simulateCommands';
import type { SimulationCommand } from '@/lib/roverBlockly';
import type { TrajectoryOutcome } from '@/core/application/services/ChallengeCheckEvaluator';

/** What the last simulated Run produced, read off the command list itself. */
function deriveOutcomes(commands: SimulationCommand[]): TrajectoryOutcome[] {
  const outcomes = new Set<TrajectoryOutcome>();
  for (const command of commands) {
    if (command.command === 'forward') outcomes.add('moved-forward');
    if (command.command === 'reverse') outcomes.add('moved-backward');
    if (command.command === 'spinLeft') outcomes.add('spun-left');
    if (command.command === 'spinRight') outcomes.add('spun-right');
  }
  return [...outcomes];
}

interface ChallengeCenterPanelProps {
  challenge: Challenge;
  onLoadMore: () => void;
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
 * does. Pressing Run reports which outcomes the simulated commands actually
 * produced (for trajectory-outcome checks); every workspace edit reports the
 * generated Python live (for code-contains checks and the Create Mission
 * handoff) via BlocklyEditor's own change listener.
 */
export function ChallengeCenterPanel({
  challenge,
  onLoadMore,
  onCodeChange,
  onBlocklyStateChange,
  onTrajectoryOutcomes,
}: ChallengeCenterPanelProps) {
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);

  if (challenge.workspaceKind === 'embedded-platform') {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="mx-auto w-full max-w-page pt-1">
          <MobileSearch />
        </div>
        <MissionFeed onLoadMore={onLoadMore} />
      </div>
    );
  }

  const handleRun = (commands: SimulationCommand[]) => {
    setTrajectory(simulateCommands(commands));
    setIsPlaying(true);
    onTrajectoryOutcomes(deriveOutcomes(commands));
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2 lg:flex-row">
      <div className="panel min-h-0 min-w-0 flex-1 overflow-hidden border border-border/60 bg-card/40 clay">
        <BlocklyEditor
          onGenerateCommands={handleRun}
          onCodeChange={onCodeChange}
          onBlocklyStateChange={onBlocklyStateChange}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <SimulationPanel
          trajectory={trajectory}
          isPlaying={isPlaying}
          onReset={() => {
            setTrajectory([]);
            setIsPlaying(false);
          }}
          editorMode="blockly"
          resetVersion={0}
        />
      </div>
    </div>
  );
}
