/**
 * @jest-environment jsdom
 */

/**
 * The console's side of showing the oldest waiting mission first. See
 * operatorQueueNewestFirst.test.tsx for the query contract.
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

// As the query delivers them: oldest first. The queue shows the mission that
// has waited longest at the top and the newest arrival at the end.
const OLDEST_FIRST = [mission('a', 'Bright Storm Climber', 17), mission('b', 'Jolly Meteor Rover', 24), mission('c', 'Proud Crater Mapper', 29)];

function renderQueue(olderHidden: boolean) {
  render(
    <SearchProvider>
      <MissionQueue role="operator" yardId="curiosity" yardName="Curiosity" yards={[]} />
    </SearchProvider>,
  );
  act(() => emit(OLDEST_FIRST, olderHidden));
}

const row = (name: RegExp) => screen.getByRole('button', { name });

it('lists the oldest waiting mission first', () => {
  renderQueue(false);
  const names = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
  expect(names[0]).toMatch(/Bright Storm Climber/);
  expect(names[2]).toMatch(/Proud Crater Mapper/);
});

it('numbers missions from the newest arrival, so the oldest waiting mission is not #1', () => {
  renderQueue(false);
  expect(within(row(/Bright Storm Climber/)).getByText('3')).toBeInTheDocument();
  expect(within(row(/Proud Crater Mapper/)).getByText('1')).toBeInTheDocument();
});

it('says when older waiting missions are not on screen', () => {
  renderQueue(true);
  expect(screen.getByRole('status')).toHaveTextContent(/older waiting missions are not shown/i);
});

it('says nothing when the whole queue is on screen', () => {
  renderQueue(false);
  expect(screen.queryByText(/older waiting missions are not shown/i)).not.toBeInTheDocument();
});
