'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { AlertTriangle, Play } from 'lucide-react';
import { type SimulationCommand } from '@/lib/roverBlockly';
import { parseRoverCode } from '@/lib/parseRoverCode';
import { checkLearnerCode, type CodeProblem } from '@/core/domain/safety/learnerCodeCheck';
import {
  ROVER_COMMAND_HELP,
  commandAt,
  helpAsMarkdown,
} from '@/lib/roverCommandHelp';

interface MonacoCodeEditorProps {
  onGenerateCommands: (commands: SimulationCommand[]) => void;
  onCodeChange?: (code: string) => void;
  /** The Python the learner's blocks produce, if they have built any. */
  blocklyCode?: string;
}

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

export function MonacoCodeEditor({ onGenerateCommands, onCodeChange, blocklyCode = '' }: MonacoCodeEditorProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  // Monaco editor + namespace instances (provided untyped by the editor lib).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoRef = useRef<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem('rover_monaco_code');

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

    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of editor contents from storage or the block workspace
    setCode(initialCode);

    if (onCodeChange) {
      onCodeChange(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount to hydrate
  }, []);


  // Monaco's own internal services (tokenization, model disposal, etc.) use
  // a "Canceled" sentinel error for work that gets interrupted - normally
  // swallowed internally, but disposing the editor externally (switching
  // away from this tab, which unmounts it) races one of those in-flight
  // operations often enough to leak an unhandled rejection. This is
  // Monaco/vscode's own long-documented pattern, not application code we can
  // add a try/catch around - narrowly matches on the exact message so it
  // can't mask an unrelated real rejection.
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (event.reason?.message === 'Canceled') {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Monaco editor/namespace instances from @monaco-editor/react onMount
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorReady(true);
  };

  /**
   * Teach the commands where the learner meets them.
   *
   * A child writing Python rather than dragging blocks had nothing at all:
   * rover.reverse(60) with no hint that reverse means backwards, or that 60 is
   * a speed rather than a distance. Hovering explains a command; typing offers
   * the list with the same words. Same source as the block comments, so the two
   * halves of the app never explain the same command differently.
   */
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!editorReady || !monaco) return;

    const hover = monaco.languages.registerHoverProvider('python', {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Monaco model/position types
      provideHover(model: any, position: any) {
        const name = commandAt(
          model.getLineContent(position.lineNumber),
          position.column,
        );
        const markdown = name && helpAsMarkdown(name);
        return markdown ? { contents: [{ value: markdown }] } : null;
      },
    });

    const completion = monaco.languages.registerCompletionItemProvider('python', {
      triggerCharacters: ['.'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Monaco model/position types
      provideCompletionItems(model: any, position: any) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        return {
          suggestions: Object.entries(ROVER_COMMAND_HELP).map(([name, help]) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: help.summary,
            documentation: { value: helpAsMarkdown(name) ?? help.summary },
            insertText: help.example,
            range,
          })),
        };
      },
    });

    // Disposed on unmount, or switching tabs twice would register the provider
    // again and show every suggestion doubled.
    return () => {
      hover.dispose();
      completion.dispose();
    };
  }, [editorReady]);

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

  // Monaco's own squiggles, which are what put the problem ON the line rather
  // than in a list underneath it. Separate from the calculation above because
  // this one genuinely is a side effect on something outside React, and it has
  // to wait for the editor to exist.
  useEffect(() => {
    if (!editorReady || !editorRef.current || !monacoRef.current) return;

    const model = editorRef.current.getModel();
    if (!model) return;

    monacoRef.current.editor.setModelMarkers(
      model,
      'rover-validator',
      validationErrors.map((err) => ({
        startLineNumber: err.line,
        startColumn: 1,
        endLineNumber: err.line,
        endColumn: model.getLineMaxColumn(err.line),
        message: err.message,
        severity: monacoRef.current.MarkerSeverity.Error,
      })),
    );
  }, [validationErrors, editorReady]);

  const handleCodeChange = (value: string | undefined) => {
    const newCode = value || '';
    setCode(newCode);
    localStorage.setItem('rover_monaco_code', newCode);
    setError(null);

    // Notify parent of code change
    if (onCodeChange) {
      onCodeChange(newCode);
    }
  };

  const insertSnippet = (snippet: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    editor.executeEdits('palette', [{ range: selection, text: snippet, forceMoveMarkers: true }]);
    editor.focus();
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

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
        <Editor
          height="100%"
          defaultLanguage="python"
          value={code}
          onChange={handleCodeChange}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}

// parseRoverCode lives in @/lib/parseRoverCode so the mission detail page can
// re-simulate a stored mission from its code too.
