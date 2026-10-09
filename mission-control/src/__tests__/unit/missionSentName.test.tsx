/**
 * @jest-environment jsdom
 */

/**
 * The confirmation says what the mission is called (8 October 2026).
 *
 * The server names a mission when it arrives, so this dialog is the first
 * place a learner sees the name, and the name is how they find it again.
 */

import { render, screen } from '@testing-library/react';

import { MissionSentDialog } from '@/components/mission/MissionSentDialog';

beforeAll(() => {
  global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
  global.cancelAnimationFrame = (id: number) => clearTimeout(id);
});

it('says the name the server gave the mission', () => {
  render(<MissionSentDialog open onClose={() => {}} email={null} name="Valiant Comet Ranger" />);
  expect(screen.getByRole('dialog')).toHaveTextContent('It is called Valiant Comet Ranger.');
});

it('says nothing about a name it was not given', () => {
  render(<MissionSentDialog open onClose={() => {}} email={null} name={null} />);
  expect(screen.getByRole('dialog')).not.toHaveTextContent('It is called');
});
