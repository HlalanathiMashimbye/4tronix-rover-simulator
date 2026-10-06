'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { Gamepad2, Blocks, Code2, AlertTriangle } from 'lucide-react';
import { ManualControlRealtime } from '@/components/mission/ManualControlRealtime';
import { BlocklyEditor } from '@/components/mission/BlocklyEditor';
import { ModeSwitch, type ModeOption } from '@/components/mission/ModeSwitch';
import { useIsPhoneLayout } from '@/hooks/useIsPhoneLayout';
import type { TrajectoryPoint } from '@/lib/simulateCommands';
import type { Yard } from '@/lib/rover-physics';
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
// The Python editor starts downloading on the first sign of interest in its
// tab (see loadPythonEditor).
const MODES: ModeOption<EditorMode>[] = [
  { value: 'manual', label: 'Drive', Icon: Gamepad2 },
  { value: 'blockly', label: 'Blocks', Icon: Blocks },
  { value: 'code', label: 'Python', Icon: Code2, onIntent: prefetchPythonEditor },
];

/** Where each mode sits on the switch, left to right. */
const ORDER: Record<EditorMode, number> = { manual: 0, blockly: 1, code: 2 };

/**
 * The editors swipe like cards: the new one springs in from the side the
 * learner moved towards and slides over the old one, which drifts the other
 * way, shrinks and fades as if pushed back. `direction` is +1 moving right
 * along the switch, -1 moving left.
 */
const SWIPE: Variants = {
  enter: (direction: number) => ({ x: `${direction * 100}%`, scale: 0.96, opacity: 0.6 }),
  centre: { x: 0, scale: 1, opacity: 1 },
  exit: (direction: number) => ({ x: `${direction * -30}%`, scale: 0.92, opacity: 0 }),
};
/** Close to critically damped: it glides in and stops without wobbling a whole editor. */
const CARD_SPRING = { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 } as const;
const FADE: Variants = { enter: { opacity: 0 }, centre: { opacity: 1 }, exit: { opacity: 0 } };

interface EditorPanelProps {
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
  error: string | null;

  onManualTrajectory: (trajectory: TrajectoryPoint[]) => void;
  manualResetVersion: number;
  /** The yard Drive drives in (AB#468). */
  yard?: Yard;
  onGenerateCommands: (commands: SimulationCommand[]) => void;
  onCodeChange: (code: string) => void;
  onBlocklyCode: (code: string) => void;
  blocklyCode: string;
  onShowAsPython: () => void;
  onBlocklyStateChange?: (state: string) => void;
  /** What the simulator is running right now, to light up in the editor. */
  highlight?: CommandSource | null;
  /** Hands the active editor's Run up, for a Run button outside the editor. */
  onRegisterRun?: (run: (() => void) | null) => void;
}

export function EditorPanel({
  editorMode,
  onEditorModeChange,
  error,
  onManualTrajectory,
  manualResetVersion,
  yard,
  onGenerateCommands,
  onCodeChange,
  onBlocklyCode,
  blocklyCode,
  onShowAsPython,
  onBlocklyStateChange,
  highlight = null,
  onRegisterRun,
}: EditorPanelProps) {
  const reduceMotion = useReducedMotion();
  // Blockly reads its layout options once, at inject, so a change of layout
  // (rotating a tablet, resizing a window) remounts the block editor, keyed
  // below, rather than leaving a phone with the desktop's toolbox. The
  // workspace autosaves on every change, so the remount loses nothing.
  const isPhone = useIsPhoneLayout();

  // The Blocks and Python tabs each used to start downloading their editor
  // only when clicked, which is most of why opening them took seconds. Blockly
  // is fetched while the page is idle; the Python editor on the first sign of
  // interest in its tab (see loadPythonEditor).
  useEffect(() => prefetchBlockly(), []);

  // Which way the switch moved, kept from the last mode it showed (React's
  // "state from the previous render" pattern, not an effect, so the first
  // frame of the swipe already knows its direction).
  const [shown, setShown] = useState({ mode: editorMode, direction: 1 });
  if (shown.mode !== editorMode) {
    setShown({ mode: editorMode, direction: ORDER[editorMode] > ORDER[shown.mode] ? 1 : -1 });
  }
  const { direction } = shown;

  // ONLY THE EDITOR ON SCREEN SPEAKS. The one swiping out stays mounted until
  // it has gone, and it would otherwise still be wired up: its unmount
  // un-registers Run, which would take Run away from the editor that just
  // arrived, and Drive keeps reporting the rover's path for as long as it is
  // mounted. So each editor's callbacks pass through only while its mode is
  // the current one. Set in a layout effect, which runs before any editor's
  // own effects, so an arriving editor's first registration gets through.
  const activeRef = useRef(editorMode);
  useLayoutEffect(() => {
    activeRef.current = editorMode;
  }, [editorMode]);
  const wired = useMemo(() => {
    function only<A extends unknown[]>(mode: EditorMode, callback: ((...args: A) => void) | undefined) {
      return callback
        ? (...args: A) => {
            if (activeRef.current === mode) callback(...args);
          }
        : undefined;
    }
    return {
      manualTrajectory: only('manual', onManualTrajectory)!,
      blocks: {
        generate: only('blockly', onGenerateCommands)!,
        code: only('blockly', (code: string) => {
          onCodeChange(code);
          onBlocklyCode(code);
        })!,
        state: only('blockly', onBlocklyStateChange),
        register: only('blockly', onRegisterRun),
      },
      python: {
        generate: only('code', onGenerateCommands)!,
        code: only('code', onCodeChange)!,
        register: only('code', onRegisterRun),
      },
    };
  }, [onManualTrajectory, onGenerateCommands, onCodeChange, onBlocklyCode, onBlocklyStateChange, onRegisterRun]);

  return (
    <div className="panel flex h-full flex-col gap-1.5 overflow-hidden border border-border/60 bg-card/40 clay">
      {/* Slim, a slider rather than three buttons, and shorter than those
          were (6 Oct 2026: "too tall"). */}
      <ModeSwitch options={MODES} value={editorMode} onChange={onEditorModeChange} label="How to program your rover" />

      {error && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-destructive">{error}</p>
        </div>
      )}

      {/* The editor, swiping in from the side the switch moved towards
          (SWIPE). popLayout lifts the leaving one out of the flow, so both
          share the frame while they pass and nothing below jumps; the
          arriving one comes later in the page, so it passes over the top. A
          fade under reduced motion. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={editorMode}
            custom={direction}
            variants={reduceMotion ? FADE : SWIPE}
            initial="enter"
            animate="centre"
            exit="exit"
            transition={reduceMotion ? { duration: 0.12 } : { x: CARD_SPRING, scale: CARD_SPRING, opacity: { duration: 0.25 } }}
            className="h-full w-full overflow-hidden rounded-xl"
          >
            {editorMode === 'manual' && (
              <ManualControlRealtime
                onTrajectoryUpdate={wired.manualTrajectory}
                resetVersion={manualResetVersion}
                yard={yard}
              />
            )}
            {editorMode === 'blockly' && <BlocklyEditor key={isPhone ? 'phone' : 'desktop'} phone={isPhone} onGenerateCommands={wired.blocks.generate} onCodeChange={wired.blocks.code} onBlocklyStateChange={wired.blocks.state} onShowAsPython={isPhone ? undefined : onShowAsPython} highlight={highlight} onRegisterRun={wired.blocks.register} />}
            {editorMode === 'code' && <PythonCodeEditor onGenerateCommands={wired.python.generate} onCodeChange={wired.python.code} blocklyCode={blocklyCode} highlight={highlight} onRegisterRun={wired.python.register} phone={isPhone} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
