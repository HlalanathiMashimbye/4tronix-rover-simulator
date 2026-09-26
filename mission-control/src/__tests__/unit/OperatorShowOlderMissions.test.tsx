/**
 * @jest-environment jsdom
 */

/**
 * The operator can page back through finished missions, like the learner feed.
 *
 * Done used to stop at the newest 25 with no way past them, so a recording
 * attached days late, or a mission someone asked about after an event, was
 * unreachable from the console unless the operator could remember its name.
 */

import { act, render, screen, fireEvent, within } from '@testing-library/react';

const subscribeToYardCompleted = jest.fn();

jest.mock('@/infrastructure/persistence/operatorQueueService', () => ({
  subscribeToYardQueue: (_yard: string, onMissions: (m: unknown[]) => void) => {
    onMissions([{ id: 'q', name: 'Still Waiting', code: '', status: 'queued' }]);
    return () => {};
  },
  subscribeToMissionRuns: () => () => {},
  subscribeToMission: () => () => {},
  subscribeToYardCompleted: (...args: unknown[]) => subscribeToYardCompleted(...args),
}));

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blockly" />,
}));

import { MissionQueue } from '@/components/operator/MissionQueue';
import { SearchProvider } from '@/contexts/SearchContext';

type Emit = (missions: unknown[], hasMore: boolean) => void;

function finished(from: number, to: number) {
  return Array.from({ length: to - from }, (_, i) => ({
    id: `f${from + i}`,
    name: `Finished ${from + i}`,
    code: '',
    status: 'completed' as const,
    youtubeUrl: 'https://youtu.be/x',
  }));
}

/**
 * Each subscription's page count and its emitter, in order. The first page
 * answers at once; later ones wait for the test, so it can look at the
 * console while the wider page is still on its way.
 */
let subscriptions: { pages: number; emit: Emit }[];

function renderConsole(firstPage: unknown[], hasMore: boolean) {
  subscriptions = [];
  subscribeToYardCompleted.mockImplementation(
    (_yard: string, onMissions: Emit, _onError: unknown, pages = 1) => {
      subscriptions.push({ pages, emit: onMissions });
      if (subscriptions.length === 1) onMissions(firstPage, hasMore);
      return () => {};
    },
  );
  return render(
    <SearchProvider>
      <MissionQueue role="operator" yardId="curiosity" yardName="Observatory" yards={[]} />
    </SearchProvider>,
  );
}

function chips() {
  return within(screen.getByRole('group', { name: 'Filter missions by status' }));
}

function open(filter: RegExp) {
  fireEvent.click(chips().getByRole('button', { name: filter }));
}

function olderButton() {
  return screen.queryByRole('button', { name: /show older missions|loading/i });
}

describe('Done pages back through older missions', () => {
  it('offers older missions when there are more than one page', () => {
    renderConsole(finished(0, 25), true);
    open(/done/i);

    expect(olderButton()).toHaveTextContent('Show older missions');
  });

  it('asks for the next page and shows it when it arrives', () => {
    renderConsole(finished(0, 25), true);
    open(/done/i);

    fireEvent.click(olderButton()!);

    expect(subscriptions.at(-1)!.pages).toBe(2);
    act(() => subscriptions.at(-1)!.emit(finished(0, 50), false));

    expect(screen.getByText('Finished 49')).toBeInTheDocument();
  });

  it('keeps the rows already shown while the older page loads', () => {
    /**
     * Asking for a page re-attaches the listener. Clearing the list while it
     * did blanked every row the operator was reading, and lost their place.
     */
    renderConsole(finished(0, 25), true);
    open(/done/i);

    fireEvent.click(olderButton()!);

    expect(screen.getByText('Finished 0')).toBeInTheDocument();
    expect(olderButton()).toHaveTextContent('Loading');
    expect(olderButton()).toBeDisabled();
  });

  it('stops offering once the oldest mission is on screen', () => {
    renderConsole(finished(0, 25), true);
    open(/done/i);

    fireEvent.click(olderButton()!);
    act(() => subscriptions.at(-1)!.emit(finished(0, 40), false));

    expect(olderButton()).not.toBeInTheDocument();
  });

  it('offers nothing at a yard with one page of finished missions', () => {
    renderConsole(finished(0, 3), false);
    open(/done/i);

    expect(screen.getByText('Finished 0')).toBeInTheDocument();
    expect(olderButton()).not.toBeInTheDocument();
  });

  it('is not offered under Needs video, where the older page may add no rows', () => {
    renderConsole(
      finished(0, 25).map((m) => ({ ...m, youtubeUrl: undefined })),
      true,
    );
    open(/needs video/i);

    expect(screen.getByText('Finished 0')).toBeInTheDocument();
    expect(olderButton()).not.toBeInTheDocument();
  });
});
