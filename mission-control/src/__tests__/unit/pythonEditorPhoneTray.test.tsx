/**
 * @jest-environment jsdom
 */

/**
 * The Python editor's rover commands (AB#455).
 *
 * They took a row of a screen the docked simulator already shares, so on a
 * phone they wait behind a help button and slide out when asked for. On a
 * laptop they were a row of ten chips that took the editor's height and
 * spilled over two rows on a narrow screen (6 Oct 2026), so there they open
 * as a card from an i button beside Run, and close once one is picked.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PythonCodeEditor } from '@/components/mission/PythonCodeEditor';

// jsdom does no layout, and CodeMirror measures text ranges when a chip
// inserts code and scrolls to it. Empty rects are enough for it to carry on.
beforeAll(() => {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

beforeEach(() => localStorage.clear());

const chip = () => screen.queryByRole('button', { name: /Forward/ });

it('keeps the chips behind the help button on a phone, and slides them out on request', async () => {
  render(<PythonCodeEditor onGenerateCommands={() => {}} phone />);
  expect(chip()).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Show rover commands' }));
  expect(screen.getByRole('toolbar', { name: 'Rover commands' })).toContainElement(chip());

  fireEvent.click(screen.getByRole('button', { name: 'Hide rover commands' }));
  await waitFor(() => expect(chip()).not.toBeInTheDocument());
});

it('stays open while chips are tapped, since a program needs more than one', () => {
  render(<PythonCodeEditor onGenerateCommands={() => {}} phone />);
  fireEvent.click(screen.getByRole('button', { name: 'Show rover commands' }));
  fireEvent.click(chip()!);
  expect(screen.getByRole('toolbar', { name: 'Rover commands' })).toBeInTheDocument();
});

describe('on a laptop', () => {
  const card = () => screen.queryByRole('dialog', { name: 'Rover commands' });
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Rover commands' }));

  it('keeps them behind the i button beside Run, not in a row over the editor', () => {
    render(<PythonCodeEditor onGenerateCommands={() => {}} />);
    expect(chip()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show rover commands' })).not.toBeInTheDocument();
    open();
    expect(card()).toContainElement(chip());
    expect(screen.getByRole('button', { name: 'Rover commands' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('puts the picked command in the editor and closes', async () => {
    const onCodeChange = jest.fn();
    render(<PythonCodeEditor onGenerateCommands={() => {}} onCodeChange={onCodeChange} />);
    open();
    fireEvent.click(chip()!);
    expect(onCodeChange.mock.lastCall![0]).toContain('# Drive forward for 1 second');
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });

  it('closes on Escape, handing focus back to the i button, without adding anything', async () => {
    const onCodeChange = jest.fn();
    render(<PythonCodeEditor onGenerateCommands={() => {}} onCodeChange={onCodeChange} />);
    const calls = onCodeChange.mock.calls.length;
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(card()).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Rover commands' })).toHaveFocus();
    expect(onCodeChange.mock.calls.length).toBe(calls);
  });

  it('closes on a click anywhere else', async () => {
    render(<PythonCodeEditor onGenerateCommands={() => {}} />);
    open();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(card()).not.toBeInTheDocument());
  });

  it('stays open for a click inside the card that is not a command', () => {
    render(<PythonCodeEditor onGenerateCommands={() => {}} />);
    open();
    fireEvent.pointerDown(screen.getByText('Rover commands', { selector: 'p' }));
    // The button, not the card: a closing card stays on the page while it
    // animates away.
    expect(screen.getByRole('button', { name: 'Rover commands' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('is not on a phone, which has its own tray', () => {
    render(<PythonCodeEditor onGenerateCommands={() => {}} phone />);
    expect(screen.queryByRole('button', { name: 'Rover commands' })).not.toBeInTheDocument();
  });
});
