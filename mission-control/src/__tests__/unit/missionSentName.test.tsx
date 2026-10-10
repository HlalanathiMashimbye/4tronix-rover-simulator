/**
 * @jest-environment jsdom
 */

/**
 * The confirmation says what the mission is called (8 October 2026).
 *
 * The name is how a learner finds their mission again. It is usually the one
 * they rolled; when another mission took that name first, it is not, and a
 * name that changed without a word is one they would look for and not find.
 */

import { render, screen } from '@testing-library/react';

import { MissionSentDialog } from '@/components/mission/MissionSentDialog';

beforeAll(() => {
  global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
  global.cancelAnimationFrame = (id: number) => clearTimeout(id);
});

it('says what the mission is called', () => {
  render(<MissionSentDialog open onClose={() => {}} email={null} name="Valiant Comet Ranger" />);
  expect(screen.getByRole('dialog')).toHaveTextContent('It is called Valiant Comet Ranger.');
});

it('says so when the rolled name had just been taken', () => {
  render(<MissionSentDialog open onClose={() => {}} email={null} name="Keen Gale Scout" renamed />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(/just took that name, so yours is called Keen Gale Scout\./);
  expect(dialog).not.toHaveTextContent('It is called');
});

it('says nothing about a name it was not given', () => {
  render(<MissionSentDialog open onClose={() => {}} email={null} name={null} />);
  expect(screen.getByRole('dialog')).not.toHaveTextContent('It is called');
});
