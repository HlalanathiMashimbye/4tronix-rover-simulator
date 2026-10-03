'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, type StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit, bracketMatching } from '@codemirror/language';
import { closeBrackets, completionKeymap } from '@codemirror/autocomplete';
import { setDiagnostics } from '@codemirror/lint';
import { python } from '@codemirror/lang-python';
import { AlertTriangle, Play } from 'lucide-react';
import { type CommandSource, type SimulationCommand } from '@/lib/roverBlockly';
import { parseRoverCode } from '@/lib/parseRoverCode';
import { checkLearnerCode, type CodeProblem } from '@/core/domain/safety/learnerCodeCheck';
import { roverPythonExtensions, setRunningLines } from '@/components/mission/roverPythonEditor';

interface PythonCodeEditorProps {
  onGenerateCommands: (commands: SimulationCommand[]) => void;
  onCodeChange?: (code: string) => void;
  /** The Python the learner's blocks produce, if they have built any. */
  blocklyCode?: string;
  /** What the simulator is running right now (AB#450). */
  highlight?: CommandSource | null;
}

/**
 * Where the draft is kept. Still named for Monaco on purpose: renaming it
 * would hand every returning learner an empty editor, and the mission page's
 * Remix button and Show as Python write to this key too. Not exported: those
 * would then import this module, and with it the whole editor.
 */
const PYTHON_DRAFT_KEY = 'rover_monaco_code';

// The real rover API: speed is 0-100, and you control how long a move lasts
// with time.sleep() then rover.stop() - exactly what the blocks generate.
const DEFAULT_CODE = `# Drive your rover. Speed is 0-100, time is in seconds.
rover.forward(60)
time.sleep(1.5)
rover.stop()

rover.spinRight(60)
time.sleep(0.5)
rover.stop()

rover.forward(60)
time.sleep(1.5)
rover.stop()
`;

// Snippets the palette inserts. Colours echo the Blockly categories so the
// Python tab reads as "the same blocks, written out".
const SNIPPETS: { label: string; colour: string; code: string }[] = [
  { label: 'Forward', colour: '#2196F3', code: '# Drive forward for 1 second. 60 is the speed, 0 to 100.\nrover.forward(60)\ntime.sleep(1)\nrover.stop()\n' },
  { label: 'Backward', colour: '#2196F3', code: '# Drive backwards for 1 second. reverse means backwards.\nrover.reverse(60)\ntime.sleep(1)\nrover.stop()\n' },
  { label: 'Spin left', colour: '#9C27B0', code: '# Spin left on the spot for half a second\nrover.spinLeft(60)\ntime.sleep(0.5)\nrover.stop()\n' },
  { label: 'Spin right', colour: '#9C27B0', code: '# Spin right on the spot for half a second\nrover.spinRight(60)\ntime.sleep(0.5)\nrover.stop()\n' },
  {
    label: 'Steer left',
    colour: '#00BCD4',
    code:
      '# Steer left: angle the wheels, drive, then straighten up again\n' +
      'rover.setServo(9, -20)\nrover.setServo(15, -20)\nrover.setServo(11, 20)\nrover.setServo(13, 20)\n' +
      'rover.forward(60)\ntime.sleep(1)\nrover.stop()\n' +
      'rover.setServo(9, 0)\nrover.setServo(11, 0)\nrover.setServo(13, 0)\nrover.setServo(15, 0)\n',
  },
  {
    label: 'Steer right',
    colour: '#00BCD4',
    code:
      '# Steer right: angle the wheels, drive, then straighten up again\n' +
      'rover.setServo(9, 20)\nrover.setServo(15, 20)\nrover.setServo(11, -20)\nrover.setServo(13, -20)\n' +
      'rover.forward(60)\ntime.sleep(1)\nrover.stop()\n' +
      'rover.setServo(9, 0)\nrover.setServo(11, 0)\nrover.setServo(13, 0)\nrover.setServo(15, 0)\n',
  },
  { label: 'Stop', colour: '#f44336', code: 'rover.stop()\n' },
  { label: 'Wait', colour: '#FF9800', code: 'time.sleep(1)\n' },
  { label: 'Repeat', colour: '#FF9800', code: 'for _ in range(3):\n    rover.forward(60)\n    time.sleep(1)\n    rover.stop()\n' },
  { label: 'Lights', colour: '#673AB7', code: 'rover.setColor(rover.fromRGB(255, 0, 0))\nrover.show()\n' },
];

export function PythonCodeEditor({ onGenerateCommands, onCodeChange, blocklyCode = '', highlight = null }: PythonCodeEditorProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The latest callback, read by the editor's update listener, which is
  // created once and would otherwise keep calling the first render's.
  const onCodeChangeRef = useRef(onCodeChange);
  useEffect(() => {
    onCodeChangeRef.current = onCodeChange;
  });

  useEffect(() => {
    if (!hostRef.current) return;
    const saved = localStorage.getItem(PYTHON_DRAFT_KEY);

    // SHOW THE BLOCKS' PYTHON WHEN THERE IS NOTHING TO LOSE.
    //
    // The two tabs were entirely independent: this editor only ever loaded its
    // own localStorage draft, while the Python the blocks generate went
    // straight to the submission and was never displayed. So a learner who
    // built something and then opened this tab to see what it looked like -
    // the exact thing AB#413's comments are written for - saw a default
    // snippet instead of their own program.
    //
    // Only when the draft is untouched. Somebody's hand-written code is theirs,
    // and silently replacing it with a generated version would be far worse
    // than the problem this fixes. There is a button below for the rest.
    const untouched = !saved || saved.trim() === DEFAULT_CODE.trim();
    const initialCode = untouched && blocklyCode.trim() ? blocklyCode : saved || DEFAULT_CODE;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialCode,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          closeBrackets(),
          python(),
          indentUnit.of('    '),
          EditorView.lineWrapping,
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          roverPythonExtensions(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            setCode(next);
            localStorage.setItem(PYTHON_DRAFT_KEY, next);
            setError(null);
            onCodeChangeRef.current?.(next);
          }),
        ],
      }),
    });
    viewRef.current = view;

    setCode(initialCode);
    onCodeChangeRef.current?.(initialCode);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount to hydrate
  }, []);

  /**
   * THE REAL RULES, not a second opinion.
   *
   * This used to be seven hand-written regexes for import/eval/os, which meant
   * the editor stayed silent on everything a learner actually gets wrong: a
   * speed of 6300, a mistyped command, a bracket that never closes. The
   * allowlist analyser had known about the first two since PR #78, with line
   * numbers, and nothing asked it. Mission "Elsje" reached the yard carrying
   * rover.forward(6300) because of exactly that gap.
   *
   * DERIVED FROM THE CODE rather than pushed into state by a handler. Doing it
   * on keystroke and on mount missed the case that matters most: a draft
   * restored from localStorage. A learner who closed the tab with a bad speed
   * in it came back to a clean-looking editor and had to type something before
   * anyone mentioned the problem, which is the same silence this story is
   * about, just later in the day. Derived state cannot fall out of step with
   * the thing it describes.
   */
  const validationErrors: CodeProblem[] = useMemo(() => checkLearnerCode(code), [code]);

  // The squiggles, which are what put the problem ON the line rather than in
  // a list underneath it. A side effect on something outside React, so it
  // lives here rather than in the calculation above.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    view.dispatch(
      setDiagnostics(
        view.state,
        validationErrors
          .filter((err) => err.line >= 1 && err.line <= doc.lines)
          .map((err) => {
            const line = doc.line(err.line);
            return { from: line.from, to: line.to, severity: 'error' as const, message: err.message };
          }),
      ),
    );
  }, [validationErrors]);

  // Light up the running lines (AB#450). Editor state rather than a selection,
  // so it does not move the learner's cursor or fight their typing.
  const fromLine = highlight?.fromLine;
  const toLine = highlight?.toLine ?? fromLine;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const range = fromLine && toLine ? { from: fromLine, to: toLine } : null;
    const effects: StateEffect<unknown>[] = [setRunningLines.of(range)];
    if (range && range.from <= view.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(range.from).from, { y: 'nearest' }));
    }
    view.dispatch({ effects });
  }, [fromLine, toLine]);

  const insertSnippet = (snippet: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.replaceSelection(snippet));
    view.focus();
  };

  const handleRun = () => {
    try {
      const commands = parseRoverCode(code);

      if (commands.length === 0) {
        setError('No rover moves found yet. Try a move, then time.sleep() for how long, then rover.stop().');
        return;
      }

      setError(null);
      onGenerateCommands(commands);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse code');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          Write Python using rover commands.
        </p>
        <button
          onClick={handleRun}
          className="clay clay-press flex shrink-0 items-center gap-1.5 rounded-xl bg-buzz px-3.5 py-2 text-xs font-bold text-background"
        >
          <Play className="h-3.5 w-3.5" fill="currentColor" />
          Run code
        </button>
      </div>

      {/* Insert-on-click command palette (doubles as the cheat sheet). Tap a
          chip to drop the real rover code at the cursor. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SNIPPETS.map((item) => (
          <button
            key={item.label}
            onClick={() => insertSnippet(item.code)}
            title={`Insert ${item.label} code`}
            className="clay-press inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-primary"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.colour }} />
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="rounded-xl border border-block-hat/30 bg-block-hat/10 p-2.5 text-xs text-block-hat">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {validationErrors.length} thing{validationErrors.length === 1 ? '' : 's'} to fix
          </p>
          <ul className="ml-5 mt-1.5 list-disc space-y-1">
            {validationErrors.map((err, idx) => (
              <li key={idx}>
                Line {err.line}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={hostRef} className="rover-python-editor min-h-0 flex-1 overflow-hidden rounded-xl border border-border" />
    </div>
  );
}
