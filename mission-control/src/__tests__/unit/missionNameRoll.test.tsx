/**
 * @jest-environment jsdom
 */

/**
 * Rolling a new mission name (6 Oct 2026): the die tumbles, other names roll
 * through the box like a reel, and the new one lands as the die stops.
 *
 * The roll is only for show. The mission is renamed the moment the die is
 * thrown, so Send pressed mid-roll sends the name it lands on.
 */

import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

let reduced = false;
jest.mock('motion/react', () => ({ ...jest.requireActual('motion/react'), useReducedMotion: () => reduced }));
let named = 0;
jest.mock('@/core/domain/services/missionNameGenerator', () => ({ rollMissionName: () => `Name ${++named}` }));

import { MissionNameInput } from '@/components/mission/MissionNameInput';

const onChange = jest.fn();
function Named() {
  const [name, setName] = useState('First Name');
  return (
    <MissionNameInput
      value={name}
      onChange={(next) => {
        onChange(next);
        setName(next);
      }}
    />
  );
}

const die = () => screen.getByRole('button', { name: 'Generate a random mission name' });
const box = () => document.querySelector('.nameReel')!;

beforeEach(() => {
  jest.useFakeTimers();
  reduced = false;
  named = 0;
  onChange.mockClear();
});
afterEach(() => jest.useRealTimers());

it('renames the mission the moment the die is thrown', () => {
  render(<Named />);
  fireEvent.click(die());
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('Name 1');
});

it('rolls other names through the box, then lands on the new one', () => {
  render(<Named />);
  fireEvent.click(die());
  act(() => jest.advanceTimersByTime(100));
  expect(box().textContent).not.toBe('Name 1');
  expect(box().textContent).not.toBe('First Name');
  expect(box()).toHaveAttribute('data-name-reel', 'passing');

  act(() => jest.advanceTimersByTime(1000));
  expect(box().textContent).toBe('Name 1');
  expect(box()).toHaveAttribute('data-name-reel', 'landed');
  // Only the name it lands on was ever given to the mission.
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('throws the die again on every press', () => {
  render(<Named />);
  fireEvent.click(die());
  const first = die().querySelector('svg');
  expect(first).toHaveClass('dice-roll');
  fireEvent.click(die());
  // A new element, so the tumble plays again from the start.
  expect(die().querySelector('svg')).not.toBe(first);
});

it('lands on the second throw when thrown again mid-roll', () => {
  render(<Named />);
  fireEvent.click(die());
  act(() => jest.advanceTimersByTime(100));
  fireEvent.click(die());
  const second = onChange.mock.lastCall![0];
  // Still rolling where the first throw would have landed.
  act(() => jest.advanceTimersByTime(400));
  expect(box()).toHaveAttribute('data-name-reel', 'passing');
  act(() => jest.advanceTimersByTime(1000));
  expect(box().textContent).toBe(second);
});

it('shows the new name straight away when motion is reduced', () => {
  reduced = true;
  render(<Named />);
  fireEvent.click(die());
  expect(box().textContent).toBe('Name 1');
  act(() => jest.advanceTimersByTime(100));
  expect(box().textContent).toBe('Name 1');
});
