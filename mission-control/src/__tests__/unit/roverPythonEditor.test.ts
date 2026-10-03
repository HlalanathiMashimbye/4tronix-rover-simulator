/**
 * @jest-environment jsdom
 */

/**
 * The rover-specific parts of the Python editor (AB#456).
 *
 * Moving from Monaco to CodeMirror kept the story's promises only if these
 * survived the move: hover help, autocomplete that inserts a runnable line,
 * and the running-line highlight from AB#450. Each is tested on a real
 * CodeMirror state, not a mock, so a CodeMirror upgrade that changes their
 * behaviour fails here.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  helpCard,
  roverCompletions,
  roverPythonExtensions,
  runningLineNumbers,
  setRunningLines,
} from '@/components/mission/roverPythonEditor';

function editor(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: roverPythonExtensions() }),
  });
}

describe('the help card', () => {
  it('names the command, says what it does and what its number means', () => {
    const card = helpCard('rover.reverse')!;
    expect(card.querySelector('strong')?.textContent).toBe('rover.reverse');
    expect(card.textContent).toContain('Drive backwards');
    expect(card.textContent).toContain('speed');
    expect(card.querySelector('code')?.textContent).toBe('rover.reverse(60)');
  });

  it('has nothing to say about a command that does not exist', () => {
    expect(helpCard('rover.teleport')).toBeNull();
  });
});

describe('autocomplete', () => {
  function complete(doc: string, explicit = false) {
    const state = EditorState.create({ doc });
    return roverCompletions(new CompletionContext(state, doc.length, explicit));
  }

  it('offers the rover commands as you type, replacing what was typed', () => {
    const result = complete('rover.fo')!;
    expect(result.from).toBe(0);
    const forward = result.options.find((o) => o.label === 'rover.forward');
    // Picking it writes a line that runs, not just the name.
    expect(forward?.apply).toBe('rover.forward(60)');
  });

  it('stays quiet on an empty line until asked', () => {
    expect(complete('')).toBeNull();
    expect(complete('', true)?.options.length).toBeGreaterThan(0);
  });
});

describe('the running-line highlight', () => {
  const code = ['rover.forward(60)', 'time.sleep(1)', 'rover.stop()'].join('\n');

  it('lights every line of the running command', () => {
    const view = editor(code);
    view.dispatch({ effects: setRunningLines.of({ from: 1, to: 2 }) });
    expect(runningLineNumbers(view)).toEqual([1, 2]);
    expect(view.dom.querySelectorAll('.rover-running-line')).toHaveLength(2);
  });

  it('clears when nothing is running', () => {
    const view = editor(code);
    view.dispatch({ effects: setRunningLines.of({ from: 1, to: 2 }) });
    view.dispatch({ effects: setRunningLines.of(null) });
    expect(runningLineNumbers(view)).toEqual([]);
  });

  it('survives a highlight for lines the program no longer has', () => {
    const view = editor(code);
    view.dispatch({ effects: setRunningLines.of({ from: 2, to: 9 }) });
    expect(runningLineNumbers(view)).toEqual([2, 3]);
    view.dispatch({ effects: setRunningLines.of({ from: 7, to: 9 }) });
    expect(runningLineNumbers(view)).toEqual([]);
  });

  it('marks only the first running line in the margin', () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: code, extensions: [lineNumbers(), roverPythonExtensions()] }),
    });
    view.dispatch({ effects: setRunningLines.of({ from: 2, to: 3 }) });
    const marked = view.dom.querySelectorAll('.cm-gutterElement.rover-running-marker');
    expect(Array.from(marked, (el) => el.textContent)).toEqual(['2']);
  });
});
