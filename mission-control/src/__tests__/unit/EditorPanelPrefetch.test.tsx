/**
 * @jest-environment jsdom
 */

/**
 * The mission editor panel gets each editor moving before its tab is clicked.
 *
 * Blockly as soon as the panel mounts, because most learners go from Drive to
 * Blocks. Monaco only on a sign of interest in the Python tab, because it is a
 * megabyte most learners never use. See editorLoading.test.tsx for the loaders.
 */

import { render, screen, fireEvent } from '@testing-library/react';

const prefetchBlockly = jest.fn(() => () => {});
const prefetchMonaco = jest.fn();

jest.mock('@/infrastructure/browser/loadBlockly', () => ({
  prefetchBlockly: () => prefetchBlockly(),
  loadBlockly: () => new Promise(() => {}),
}));
jest.mock('@/infrastructure/browser/prefetchMonaco', () => ({
  prefetchMonaco: () => prefetchMonaco(),
}));
jest.mock('@/components/mission/ManualControlRealtime', () => ({ ManualControlRealtime: () => null }));
jest.mock('@/components/mission/BlocklyEditor', () => ({ BlocklyEditor: () => null }));
jest.mock('@/components/mission/MonacoCodeEditor', () => ({ MonacoCodeEditor: () => null }));

import { EditorPanel } from '@/components/mission/EditorPanel';

function renderPanel() {
  const noop = () => {};
  render(
    <EditorPanel
      editorMode="manual"
      onEditorModeChange={noop}
      error={null}
      onManualTrajectory={noop}
      onResetSimulation={noop}
      manualResetVersion={0}
      onGenerateCommands={noop}
      onCodeChange={noop}
      onBlocklyCode={noop}
      blocklyCode=""
      onShowAsPython={noop}
    />,
  );
}

beforeEach(() => jest.clearAllMocks());

it('starts fetching Blockly as soon as it mounts, so the Blocks tab is ready when clicked', () => {
  renderPanel();

  expect(prefetchBlockly).toHaveBeenCalledTimes(1);
});

it('does not fetch the Python editor until someone shows interest in it', () => {
  renderPanel();

  expect(prefetchMonaco).not.toHaveBeenCalled();
  fireEvent.pointerEnter(screen.getByRole('button', { name: /python/i }));
  expect(prefetchMonaco).toHaveBeenCalled();
});

it('warms the Python editor for keyboard users too', () => {
  renderPanel();

  fireEvent.focus(screen.getByRole('button', { name: /python/i }));
  expect(prefetchMonaco).toHaveBeenCalled();
});

it('does not warm Python from the other tabs', () => {
  renderPanel();

  fireEvent.pointerEnter(screen.getByRole('button', { name: /blocks/i }));
  fireEvent.pointerEnter(screen.getByRole('button', { name: /drive/i }));
  expect(prefetchMonaco).not.toHaveBeenCalled();
});
