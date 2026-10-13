/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import { RemixButton } from '@/components/mission/RemixButton';

it('remixes when pressed', () => {
  const onRemix = jest.fn();
  render(<RemixButton onRemix={onRemix} />);

  screen.getByRole('button', { name: 'Remix' }).click();

  expect(onRemix).toHaveBeenCalledTimes(1);
});

it('is the same button, by name, after it is nudged', () => {
  // The nudge replays the bolt. It must not re-create the button, which would
  // drop a keyboard user's focus each time the simulation ended.
  const { rerender } = render(<RemixButton onRemix={() => {}} nudge={0} />);
  const before = screen.getByRole('button', { name: 'Remix' });

  rerender(<RemixButton onRemix={() => {}} nudge={1} />);

  expect(screen.getByRole('button', { name: 'Remix' })).toBe(before);
});

it('jumps its bolt again on each nudge', () => {
  // A new element per nudge is what replays the entrance (see RemixButton).
  const { rerender } = render(<RemixButton onRemix={() => {}} nudge={0} />);
  const bolt = () => screen.getByRole('button', { name: 'Remix' }).querySelector('svg')!.parentElement;
  const first = bolt();

  rerender(<RemixButton onRemix={() => {}} nudge={0} />);
  expect(bolt()).toBe(first);

  rerender(<RemixButton onRemix={() => {}} nudge={1} />);
  expect(bolt()).not.toBe(first);
});
