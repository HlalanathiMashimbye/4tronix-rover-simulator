/**
 * @jest-environment jsdom
 */

/**
 * The Python snippet chips on a phone (AB#455).
 *
 * They took a row of a screen the docked simulator already shares, so on a
 * phone they wait behind a help button and slide out when asked for. From md
 * up they stay a row, where there is room and they double as a cheat sheet.
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

it('shows them as a row, with no help button, everywhere else', () => {
  render(<PythonCodeEditor onGenerateCommands={() => {}} />);
  expect(chip()).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show rover commands' })).not.toBeInTheDocument();
});
