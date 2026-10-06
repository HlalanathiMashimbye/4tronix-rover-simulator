/**
 * @jest-environment jsdom
 */

/**
 * Switching between Drive, Blocks and Python (6 Oct 2026).
 *
 * The editors swipe like pages, so for a moment the one leaving is still
 * mounted beside the one arriving. What must hold while they pass: Run
 * belongs to the editor that arrived, the editor that left says nothing more,
 * and each comes in from the side the switch moved towards.
 */

import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/infrastructure/browser/loadBlockly', () => ({ prefetchBlockly: () => () => {}, loadBlockly: () => new Promise(() => {}) }));

// Each editor as the props it is given: Run registered on mount and handed
// back on unmount, as the real ones do.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = any;
let driveReports: Props = null;
const blocksRun = () => {};
const pythonRun = () => {};
function editor(testId: string, run: () => void) {
  return function Editor({ onRegisterRun }: Props) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(() => {
      onRegisterRun?.(run);
      return () => onRegisterRun?.(null);
    }, [onRegisterRun]);
    return <div data-testid={testId} />;
  };
}
jest.mock('@/components/mission/ManualControlRealtime', () => ({
  ManualControlRealtime: ({ onTrajectoryUpdate }: Props) => {
    driveReports = onTrajectoryUpdate;
    return <div data-testid="drive" />;
  },
}));
jest.mock('@/components/mission/BlocklyEditor', () => ({ BlocklyEditor: editor('blocks', blocksRun) }));
jest.mock('@/components/mission/loadPythonEditor', () => ({
  prefetchPythonEditor: () => {},
  loadPythonEditor: () => Promise.resolve({ PythonCodeEditor: editor('python', pythonRun) }),
}));

import { EditorPanel, type EditorMode } from '@/components/mission/EditorPanel';

let registered: (() => void) | null | undefined;
const onManualTrajectory = jest.fn();

function Panel({ start }: { start: EditorMode }) {
  const [mode, setMode] = useState<EditorMode>(start);
  const noop = () => {};
  return (
    <EditorPanel
      editorMode={mode}
      onEditorModeChange={setMode}
      error={null}
      onManualTrajectory={onManualTrajectory}
      manualResetVersion={0}
      onGenerateCommands={noop}
      onCodeChange={noop}
      onBlocklyCode={noop}
      blocklyCode=""
      onShowAsPython={noop}
      onRegisterRun={(run) => {
        registered = run;
      }}
    />
  );
}

const pick = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));
/** The frame an editor swipes in, and how far across it starts. */
const frameOf = (testId: string) => screen.getByTestId(testId).parentElement as HTMLElement;

beforeEach(() => {
  registered = undefined;
  driveReports = null;
  onManualTrajectory.mockClear();
});

it('puts the thumb on the mode picked', () => {
  render(<Panel start="blockly" />);
  pick('Drive');
  expect(screen.getByRole('button', { name: 'Drive' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Blocks' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps Run with the editor that arrived when the one leaving finally goes', async () => {
  render(<Panel start="blockly" />);
  expect(registered).toBe(blocksRun);
  pick('Python');
  await screen.findByTestId('python');
  await waitFor(() => expect(screen.queryByTestId('blocks')).not.toBeInTheDocument());
  expect(registered).toBe(pythonRun);
});

it('lets an editor that arrives at once register its Run straight away', () => {
  // Blocks mounts in the same commit as the switch, so the gate has to know
  // the new mode before the editor's own effects run.
  render(<Panel start="manual" />);
  pick('Blocks');
  expect(registered).toBe(blocksRun);
});

it("stops Drive reporting the rover's path once it has been switched away from", () => {
  render(<Panel start="manual" />);
  const report = driveReports;
  report([]);
  expect(onManualTrajectory).toHaveBeenCalledTimes(1);
  pick('Blocks');
  // Still mounted while it swipes out, and still holding its callback.
  report([]);
  expect(onManualTrajectory).toHaveBeenCalledTimes(1);
});

it('brings an editor in from the right when the switch moves right', () => {
  render(<Panel start="manual" />);
  pick('Blocks');
  expect(frameOf('blocks').style.transform).toContain('translateX(100%)');
});

it('and from the left when it moves left', () => {
  render(<Panel start="blockly" />);
  pick('Drive');
  expect(frameOf('drive').style.transform).toContain('translateX(-100%)');
});
