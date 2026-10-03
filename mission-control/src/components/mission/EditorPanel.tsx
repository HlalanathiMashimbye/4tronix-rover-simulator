'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useReducedMotion } from 'motion/react';
import { Gamepad2, Blocks, Code2, AlertTriangle } from 'lucide-react';
import { ManualControlRealtime } from '@/components/mission/ManualControlRealtime';
import { BlocklyEditor } from '@/components/mission/BlocklyEditor';
import { ActivePillBackground } from '@/components/ui/ActivePillBackground';
import type { TrajectoryPoint } from '@/lib/simulateCommands';
import type { CommandSource, SimulationCommand } from '@/lib/roverBlockly';
import { prefetchBlockly } from '@/infrastructure/browser/loadBlockly';
import { loadPythonEditor, prefetchPythonEditor } from '@/components/mission/loadPythonEditor';

// Its own chunk, fetched when the Python tab is wanted (see loadPythonEditor).
// Client-only: the editor measures and edits the DOM it is given.
const PythonCodeEditor = dynamic(() => loadPythonEditor().then((m) => m.PythonCodeEditor), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-xl border border-border bg-[#1e1e1e]" />,
});

export type EditorMode = 'manual' | 'blockly' | 'code';

// Blocks-first ordering: tap-to-drive on-ramp, then the block editor (the hero),
// then Python for those ready for it.
const MODES: { mode: EditorMode; label: string; Icon: typeof Gamepad2 }[] = [
  { mode: 'manual', label: 'Drive', Icon: Gamepad2 },
  { mode: 'blockly', label: 'Blocks', Icon: Blocks },
  { mode: 'code', label: 'Python', Icon: Code2 },
];

interface EditorPanelProps {
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
  error: string | null;

  onManualTrajectory: (trajectory: TrajectoryPoint[]) => void;
  onResetSimulation: () => void;
  manualResetVersion: number;
  onGenerateCommands: (commands: SimulationCommand[]) => void;
  onCodeChange: (code: string) => void;
  onBlocklyCode: (code: string) => void;
  blocklyCode: string;
  onShowAsPython: () => void;
  onBlocklyStateChange?: (state: string) => void;
  /** What the simulator is running right now, to light up in the editor. */
  highlight?: CommandSource | null;
}

export function EditorPanel({
  editorMode,
  onEditorModeChange,
  error,
  onManualTrajectory,
  onResetSimulation,
  manualResetVersion,
  onGenerateCommands,
  onCodeChange,
  onBlocklyCode,
  blocklyCode,
  onShowAsPython,
  onBlocklyStateChange,
  highlight = null,
}: EditorPanelProps) {
  const reduceMotion = useReducedMotion();

  // The Blocks and Python tabs each used to start downloading their editor
  // only when clicked, which is most of why opening them took seconds. Blockly
  // is fetched while the page is idle; the Python editor on the first sign of
  // interest in its tab (see loadPythonEditor).
  useEffect(() => prefetchBlockly(), []);

  return (
    <div className="panel flex h-full flex-col gap-1.5 overflow-hidden border border-border/60 bg-card/40 clay">
      {/* Editor mode tabs */}
      <div className="flex flex-shrink-0 gap-1.5">
        {MODES.map(({ mode, label, Icon }) => {
          const active = editorMode === mode;
          return (
            <button
              key={mode}
              onClick={() => onEditorModeChange(mode)}
              onPointerEnter={mode === 'code' ? prefetchPythonEditor : undefined}
              onFocus={mode === 'code' ? prefetchPythonEditor : undefined}
              aria-pressed={active}
              className={`panel-inner relative isolate flex flex-1 items-center justify-center gap-1.5 overflow-hidden px-2 py-2 text-sm font-bold transition-colors ${
                active
                  ? 'text-primary-foreground'
                  : 'border border-border/60 bg-secondary/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              {active && (
                <ActivePillBackground layoutId="editor-mode-pill" className="panel-inner bg-gradient-mars clay" reduceMotion={reduceMotion} />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Icon className="h-4 w-4" />
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {/* Editor content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {editorMode === 'manual' && (
          <ManualControlRealtime
            onTrajectoryUpdate={onManualTrajectory}
            onReset={onResetSimulation}
            resetVersion={manualResetVersion}
          />
        )}
        {editorMode === 'blockly' && <BlocklyEditor onGenerateCommands={onGenerateCommands} onCodeChange={(c) => { onCodeChange(c); onBlocklyCode(c); }} onBlocklyStateChange={onBlocklyStateChange} onShowAsPython={onShowAsPython} highlight={highlight} />}
        {editorMode === 'code' && <PythonCodeEditor onGenerateCommands={onGenerateCommands} onCodeChange={onCodeChange} blocklyCode={blocklyCode} highlight={highlight} />}
      </div>

    </div>
  );
}
