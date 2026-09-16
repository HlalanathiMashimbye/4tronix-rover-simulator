/**
 * @jest-environment jsdom
 */

/**
 * What the operator console gives up when the screen is a phone.
 *
 * Reported as "bad for mobile, can barely use it", and measured at 375x812:
 * the header, the search field, the four filter chips and the sort control
 * took 385px before the queue started, and opening a mission left its pane
 * about 190px to hold the yard checks, the desk actions, the runs and the
 * learner's code. Most of the fix is responsive classes, which a test can only
 * assert as prose. These two are behaviour:
 *
 * - the search and filter row unmounts while a mission is open, because below
 *   lg the panes take turns and it filters a list that is not on the screen;
 * - the learner's floating Create Mission button does not render on the
 *   operator surface, where it sat over the bottom-right corner of whichever
 *   pane was showing.
 */

import { render, screen, fireEvent } from '@testing-library/react';

const subscribeToYardQueue = jest.fn();

jest.mock('@/infrastructure/persistence/operatorQueueService', () => ({
  subscribeToYardQueue: (...args: unknown[]) => subscribeToYardQueue(...args),
  subscribeToYardCompleted: () => () => {},
  subscribeToMissionRuns: () => () => {},
  subscribeToMission: () => () => {},
}));

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blockly" />,
}));

let pathname = '/operator';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: () => {} }),
}));

jest.mock('@/hooks/useCompletionNotifications', () => ({
  useCompletionNotifications: () => ({
    unread: [],
    hasUnread: false,
    markAllSeen: () => {},
    dismiss: () => {},
  }),
}));

jest.mock('@/components/learner/EmailPrompt', () => ({
  EmailPrompt: () => null,
}));

import { MissionQueue } from '@/components/operator/MissionQueue';
import { Navbar } from '@/components/layout/Navbar';
import { SearchProvider } from '@/contexts/SearchContext';

const QUEUE = [
  { id: 'a', name: 'Rock Lover', code: 'forward(60)', status: 'queued' as const },
  { id: 'b', name: 'Dune Walker', code: 'stop()', status: 'processing' as const },
];

function renderQueue() {
  subscribeToYardQueue.mockImplementation((_yard, onMissions) => {
    onMissions(QUEUE);
    return () => {};
  });
  return render(
    <SearchProvider>
      <MissionQueue
        role="operator"
        yardId="curiosity"
        yardName="Cape Town Science Centre, Observatory"
        yards={[]}
      />
    </SearchProvider>,
  );
}

describe('the queue screen on a phone', () => {
  it('takes the search and filter row off the screen while a mission is open', async () => {
    renderQueue();

    expect(await screen.findByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All in queue/ })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Rock Lover'));

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /All in queue/ })).not.toBeInTheDocument();
  });

  it('brings them back with the queue', async () => {
    renderQueue();

    fireEvent.click(await screen.findByText('Rock Lover'));
    fireEvent.click(screen.getByRole('button', { name: /Back to the queue/ }));

    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });
});

describe('the learner floating button', () => {
  afterEach(() => {
    pathname = '/operator';
  });

  it('is not on the operator surface', () => {
    pathname = '/operator';
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );

    expect(screen.queryByLabelText('Create Mission')).not.toBeInTheDocument();
  });

  it("is not on the console's own subpages", () => {
    pathname = '/operator/settings';
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );

    expect(screen.queryByLabelText('Create Mission')).not.toBeInTheDocument();
  });

  it('is still on the learner feed', () => {
    pathname = '/';
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );

    expect(screen.getByLabelText('Create Mission')).toBeInTheDocument();
  });
});
