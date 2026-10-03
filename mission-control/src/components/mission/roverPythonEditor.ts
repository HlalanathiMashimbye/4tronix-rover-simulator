/**
 * The CodeMirror 6 pieces behind the Python tab (AB#456).
 *
 * WHY CODEMIRROR AND NOT MONACO. Monaco's own README says it is not supported
 * in mobile browsers, and a reviewer could not get past a challenge on a phone.
 * It was also about 900 KB compressed, fetched from jsDelivr at runtime.
 * CodeMirror edits through a contenteditable, so touch selection, the iOS
 * keyboard and copy/paste are the browser's own, and it is bundled from our
 * domain like Blockly.
 *
 * Kept apart from PythonCodeEditor.tsx so each piece can be tested on a real
 * EditorState without mounting React: hover, autocomplete, the running-line
 * highlight and the theme. The component only wires them up.
 */

import { StateEffect, StateField, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutterLineClass, hoverTooltip, type DecorationSet } from '@codemirror/view';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { ROVER_COMMAND_HELP, commandAt } from '@/lib/roverCommandHelp';

/**
 * The help card for a command: name, meaning, what the number is, an example.
 *
 * Built as DOM rather than Markdown. Monaco rendered Markdown itself;
 * CodeMirror takes an element, and pulling in a Markdown renderer to produce
 * four lines would cost more than the editor it replaced saved.
 */
export function helpCard(name: string): HTMLElement | null {
  const help = ROVER_COMMAND_HELP[name];
  if (!help) return null;

  const card = document.createElement('div');
  card.className = 'rover-help';
  const title = document.createElement('strong');
  title.textContent = name;
  card.append(title);
  for (const text of [help.summary, help.argument]) {
    if (!text) continue;
    const p = document.createElement('p');
    p.textContent = text;
    card.append(p);
  }
  const example = document.createElement('code');
  example.textContent = help.example;
  card.append(example);
  return card;
}

/** Hovering a command explains it, from the same words the blocks use. */
const roverHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const name = commandAt(line.text, pos - line.from + 1);
  if (!name) return null;
  return {
    pos,
    above: true,
    create: () => ({ dom: helpCard(name) as HTMLElement }),
  };
});

/**
 * Typing offers the rover commands, and picking one inserts a line the
 * learner could run as-is: rover.forward(60), not just the name.
 */
export function roverCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]+/);
  if (!word && !context.explicit) return null;
  if (word && word.from === word.to && !context.explicit) return null;
  return {
    from: word ? word.from : context.pos,
    options: Object.entries(ROVER_COMMAND_HELP).map(([name, help]) => ({
      label: name,
      type: 'function',
      detail: help.summary,
      info: () => helpCard(name) as HTMLElement,
      apply: help.example,
    })),
    validFor: /^[\w.]*$/,
  };
}

/** Which lines the simulator is running; null when nothing is (AB#450). */
export const setRunningLines = StateEffect.define<{ from: number; to: number } | null>();

const runningLine = Decoration.line({ class: 'rover-running-line' });

class RunningMarker extends GutterMarker {
  elementClass = 'rover-running-marker';
}
const runningMarker = new RunningMarker();

/**
 * The running lines, as editor state rather than DOM poked from outside, so
 * CodeMirror keeps them on the right lines while it redraws. Line numbers
 * outside the document are clamped: a highlight can arrive for a program that
 * has just been shortened.
 */
const runningLines = StateField.define<{ lines: DecorationSet; first: number | null }>({
  create: () => ({ lines: Decoration.none, first: null }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setRunningLines)) continue;
      const doc = tr.state.doc;
      if (!effect.value || effect.value.from > doc.lines) return { lines: Decoration.none, first: null };
      const from = Math.max(1, effect.value.from);
      const to = Math.min(doc.lines, Math.max(from, effect.value.to));
      const builder = new RangeSetBuilder<Decoration>();
      for (let n = from; n <= to; n++) {
        const pos = doc.line(n).from;
        builder.add(pos, pos, runningLine);
      }
      return { lines: builder.finish(), first: doc.line(from).from };
    }
    return tr.docChanged ? { lines: value.lines.map(tr.changes), first: value.first === null ? null : tr.changes.mapPos(value.first) } : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.lines),
    // The margin marker goes on the first line only: one arrow per command,
    // not one per line of it.
    gutterLineClass.from(field, (value) => {
      const builder = new RangeSetBuilder<GutterMarker>();
      if (value.first !== null) builder.add(value.first, value.first, runningMarker);
      return builder.finish();
    }),
  ],
});

/** Line numbers of the running highlight, for tests. */
export function runningLineNumbers(view: EditorView): number[] {
  const out: number[] = [];
  const { lines } = view.state.field(runningLines);
  lines.between(0, view.state.doc.length, (from) => {
    out.push(view.state.doc.lineAt(from).number);
  });
  return out;
}

/** Colours close to the vs-dark theme Monaco used, so the tab looks the same. */
const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c586c0' },
  { tag: [tags.string, tags.special(tags.string)], color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#dcdcaa' },
  { tag: [tags.variableName, tags.propertyName], color: '#9cdcfe' },
  { tag: tags.bool, color: '#569cd6' },
]);

const darkTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#1e1e1e', color: '#d4d4d4' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.5' },
    '.cm-content': { caretColor: '#aeafad' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#aeafad' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#264f78' },
    '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c6c6c6' },
    '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 0.04)' },
    '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#d4d4d4' },
  },
  { dark: true },
);

/** Everything rover-specific the Python tab adds to a plain editor. */
export function roverPythonExtensions(): Extension[] {
  return [
    darkTheme,
    syntaxHighlighting(darkHighlight),
    roverHover,
    autocompletion({ override: [roverCompletions] }),
    runningLines,
  ];
}
