/**
 * @jest-environment jsdom
 */

/**
 * The console's side of the queue. The query delivers newest first, so the
 * cap never hides new work (operatorQueueNewestFirst.test.tsx); the console
 * still shows the mission that has waited longest at the top, numbered #1,
 * because that is the next job to hand to the rover.
 */

import { render, screen, within } from '@testing-library/react';

let emit: (missions: unknown[], olderHidden: boolean) => void = () => {};

jest.mock('@/infrastructure/persistence/operatorQueueService', () => ({
  subscribeToYardQueue: (_yard: string, onMissions: typeof emit) => {
    emit = onMissions;
    return () => {};
  },
  subscribeToYardCompleted: () => () => {},
  subscribeToMissionRuns: () => () => {},
  subscribeToMission: () => () => {},
}));
jest.mock('@/components/mission/BlocklyViewer', () => ({ BlocklyViewer: () => null }));

import { act } from '@testing-library/react';
import { MissionQueue } from '@/components/operator/MissionQueue';
import { SearchProvider } from '@/contexts/SearchContext';

const mission = (id: string, name: string, minute: number) => ({
  id,
  name,
  code: 'rover.stop()',
  status: 'queued' as const,
  submittedAt: `2026-09-26T12:${String(minute).padStart(2, '0')}:00Z`,
});

// As the query delivers them: newest first.
const NEWEST_FIRST = [mission('c', 'Proud Crater Mapper', 29), mission('b', 'Jolly Meteor Rover', 24), mission('a', 'Bright Storm Climber', 17)];

function renderQueue(olderHidden: boolean) {
  render(
    <SearchProvider>
      <MissionQueue role="operator" yardId="curiosity" yardName="Curiosity" yards={[]} />
    </SearchProvider>,
  );
  act(() => emit(NEWEST_FIRST, olderHidden));
}

const row = (name: RegExp) => screen.getByRole('button', { name });

it('lists the oldest waiting mission first', () => {
  renderQueue(false);
  const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
  expect(names[0]).toMatch(/Bright Storm Climber/);
  expect(names[2]).toMatch(/Proud Crater Mapper/);
});

it('numbers missions by arrival, so #1 is the one that has waited longest', () => {
  renderQueue(false);
  expect(within(row(/Bright Storm Climber/)).getByText('1')).toBeInTheDocument();
  expect(within(row(/Proud Crater Mapper/)).getByText('3')).toBeInTheDocument();
});

it('says when older waiting missions are not on screen', () => {
  renderQueue(true);
  expect(screen.getByRole('status')).toHaveTextContent(/older waiting missions are not shown/i);
});

it('says nothing when the whole queue is on screen', () => {
  renderQueue(false);
  expect(screen.queryByText(/older waiting missions are not shown/i)).not.toBeInTheDocument();
});
