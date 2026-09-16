/**
 * @jest-environment jsdom
 */

/**
 * The operator console's own shell on a phone.
 *
 * Reported as "bad for mobile, can barely use it", and measured at 390x844:
 * the learner navbar, this page's header, the search field, the filter chips
 * and the sort control took 385px before the queue started, and opening a
 * mission left its pane about 190px for the yard checks, the desk actions,
 * the runs and the learner's code. Most of the fix is responsive classes,
 * which a test can only assert as prose. What is behaviour is asserted here:
 *
 * - the queue's views are a tab bar that reads the same filter registry the
 *   chips do, choosing one closes an open mission, and a count shows as a
 *   badge only once it is known;
 * - the search field unmounts while a mission is open, because below lg the
 *   panes take turns and it searches a list that is not on the screen;
 * - the second line of a row says what is true of the mission, not its raw
 *   status;
 * - the overflow menu holds the once-a-shift actions and closes on Escape;
 * - the learner's chrome - bottom tab bar and floating Create Mission
 *   button - does not render on the operator surface.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

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
import { OperatorMobileBar } from '@/components/operator/OperatorMobileBar';
import { Navbar } from '@/components/layout/Navbar';
import { SearchProvider } from '@/contexts/SearchContext';

const QUEUE = [
  { id: 'a', name: 'Rock Lover', code: 'forward(60)', status: 'queued' as const, submittedAt: '2026-09-16T08:41:00Z' },
  { id: 'b', name: 'Dune Walker', code: 'stop()', status: 'processing' as const },
  {
    id: 'c',
    name: 'Crater Pioneer',
    code: 'stop()',
    status: 'queued' as const,
    needsReview: true,
    reviewReason: 'The satellite stopped while this mission was running.',
  },
];

const tabBar = () => screen.getByRole('navigation', { name: 'Queue views' });
const tab = (name: RegExp) => within(tabBar()).getByRole('button', { name });

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
  it('offers the views as a tab bar with counts as badges', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    expect(tab(/Queue/)).toHaveTextContent('3');
    expect(tab(/Review/)).toHaveTextContent('1');
    // Done is only counted once fetched, and an unfetched count is not zero.
    expect(tab(/Done/)).toHaveTextContent(/^Done$/);
  });

  it('takes the search field off the screen while a mission is open', async () => {
    renderQueue();
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Rock Lover'));

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    // The tabs stay: they are how the operator leaves the mission.
    expect(tabBar()).toBeInTheDocument();
  });

  it('brings it back with the queue', async () => {
    renderQueue();
    fireEvent.click(await screen.findByText('Rock Lover'));
    fireEvent.click(screen.getByRole('button', { name: /Back to the queue/ }));

    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('closes an open mission when a view is chosen', async () => {
    renderQueue();
    fireEvent.click(await screen.findByText('Rock Lover'));
    expect(screen.getByRole('button', { name: /Back to the queue/ })).toBeInTheDocument();

    fireEvent.click(tab(/Review/));

    expect(screen.queryByRole('button', { name: /Back to the queue/ })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByText('Crater Pioneer')).toBeInTheDocument();
    expect(screen.queryByText('Rock Lover')).not.toBeInTheDocument();
  });

  it('says what is true of a mission on its second line, not its raw status', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    // Scoped to the list: the chip row has a "Running now" of its own.
    const rows = within(screen.getByRole('list'));
    expect(rows.getByText('Running now')).toBeInTheDocument();
    expect(rows.getByText('The satellite stopped while this mission was running.')).toBeInTheDocument();
    expect(rows.queryByText('processing')).not.toBeInTheDocument();
    expect(rows.queryByText('queued')).not.toBeInTheDocument();
    // A waiting mission says when it arrived, in the operator's clock.
    expect(rows.getByText(/^Sent \d{2}:\d{2}/)).toBeInTheDocument();
  });
});

describe('the overflow menu', () => {
  const yard = { id: 'curiosity', name: 'Cape Town Science Centre', area: 'Observatory', city: 'Cape Town', active: true };

  it('holds the once-a-shift actions and opens on demand', () => {
    render(<OperatorMobileBar role="admin" yard={yard} isAdmin />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    const menu = screen.getByRole('menu');
    for (const item of ['Yard console', 'YouTube Studio', 'Manage access', 'Settings', 'Mission Control', 'Sign out']) {
      expect(within(menu).getByRole('menuitem', { name: item })).toBeInTheDocument();
    }
  });

  it('keeps the admin pages from an operator', () => {
    render(<OperatorMobileBar role="operator" yard={yard} isAdmin={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.queryByRole('menuitem', { name: 'Manage access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<OperatorMobileBar role="admin" yard={yard} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('the learner chrome', () => {
  afterEach(() => {
    pathname = '/operator';
  });

  it('keeps its bottom tab bar off the operator surface', () => {
    pathname = '/operator';
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );

    // Exactly "History": the laptop navbar's "My History" is a different
    // element and stays, hidden by CSS from md down.
    expect(screen.queryByRole('link', { name: 'History' })).not.toBeInTheDocument();
  });

  it('still has it on the learner feed', () => {
    pathname = '/';
    render(
      <SearchProvider>
        <Navbar />
      </SearchProvider>,
    );

    expect(screen.getByRole('link', { name: 'History' })).toBeInTheDocument();
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
