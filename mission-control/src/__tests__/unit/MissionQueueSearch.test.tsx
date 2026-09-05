/**
 * @jest-environment jsdom
 */

/**
 * The operator queue searches and filters exactly like the learner feed.
 *
 * Same control, same behaviour: an operator at a busy event is looking for one
 * mission among a queue, and reading down a list is what search exists to
 * avoid. The yard console's own queue is being retired in favour of this one,
 * so it has to be at least as good.
 */

import { render, screen, fireEvent } from '@testing-library/react';

const subscribeToYardQueue = jest.fn();
const subscribeToYardCompleted = jest.fn();

jest.mock('@/infrastructure/persistence/operatorQueueService', () => ({
  subscribeToYardQueue: (...args: unknown[]) => subscribeToYardQueue(...args),
  // Selecting a mission subscribes to its runs across yards. Not what these
  // tests are about, so it is a no-op unsubscribe.
  subscribeToMissionRuns: () => () => {},
  // Typing now also opens the settled list, so a mission that has already
  // finished can still be found by name. These tests hand it whatever
  // SETTLED holds.
  subscribeToYardCompleted: (...args: unknown[]) => subscribeToYardCompleted(...args),
}));

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blockly" />,
}));

import { MissionQueue } from '@/components/operator/MissionQueue';
import { SearchProvider } from '@/contexts/SearchContext';

const QUEUE = [
  { id: 'a', name: 'Rock Lover', code: 'rover.forward(60)', status: 'queued' as const },
  { id: 'b', name: 'Dune Walker', code: 'rover.spinLeft(30)', status: 'processing' as const },
  { id: 'c', name: 'Crater Pioneer', code: 'rover.stop()', status: 'queued' as const, needsReview: true },
];

function renderQueue(missions = QUEUE, settled: unknown[] = []) {
  subscribeToYardQueue.mockImplementation((_yard, onMissions) => {
    onMissions(missions);
    return () => {};
  });
  subscribeToYardCompleted.mockImplementation((_yard, onMissions) => {
    onMissions(settled);
    return () => {};
  });
  return render(
    <SearchProvider>
      <MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} />
    </SearchProvider>,
  );
}

function search(text: string) {
  fireEvent.change(screen.getAllByRole('searchbox')[0], { target: { value: text } });
}

describe('searching the queue', () => {
  it('narrows by mission name', async () => {
    renderQueue();
    expect(await screen.findByText('Rock Lover')).toBeInTheDocument();

    search('dune');

    expect(screen.getByText('Dune Walker')).toBeInTheDocument();
    expect(screen.queryByText('Rock Lover')).not.toBeInTheDocument();
  });

  it('narrows by code, so an operator can find a mission by what it does', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    search('spinleft');

    expect(screen.getByText('Dune Walker')).toBeInTheDocument();
    expect(screen.queryByText('Crater Pioneer')).not.toBeInTheDocument();
  });

  it('says the search matched nothing, rather than looking like an empty yard', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    search('nothing matches this');

    // An operator who reads "Nothing waiting" concludes the queue broke.
    expect(screen.getByText(/no mission in this queue matches/i)).toBeInTheDocument();
  });

  it('reports what the search found, not a fraction of one list', async () => {
    /**
     * This used to read "1 of 3", the 3 being the queue. Once a search began
     * looking at the settled list too, that fraction became a lie: the pool is
     * both lists, and a match usually comes from outside whichever chip is
     * selected, so the denominator described a list the result was not in.
     */
    renderQueue();
    await screen.findByText('Rock Lover');

    search('dune');

    expect(screen.getByText(/1 found/)).toBeInTheDocument();
    expect(screen.queryByText(/1 of 3/)).not.toBeInTheDocument();
  });
});

describe('filtering the queue', () => {
  it('offers the statuses an operator acts on', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    for (const label of ['All in queue', 'Waiting', 'Running now', 'Needs review']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('counts what is behind each filter', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    // Two waiting, one running, one flagged - visible before anything is tapped.
    expect(screen.getByRole('button', { name: /waiting\s*2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /running now\s*1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /needs review\s*1/i })).toBeInTheDocument();
  });

  it('shows only flagged missions under Needs review', async () => {
    renderQueue();
    await screen.findByText('Rock Lover');

    fireEvent.click(screen.getByRole('button', { name: /needs review/i }));

    expect(screen.getByText('Crater Pioneer')).toBeInTheDocument();
    expect(screen.queryByText('Rock Lover')).not.toBeInTheDocument();
  });
});


describe('finding a mission that has already finished', () => {
  /**
   * The report: "Search does not work sometimes, could not search for Rocky
   * Attempt". It had finished, and search only ever looked at the list behind
   * the SELECTED chip. On the default "All in queue" there was no text that
   * could find it, because it was not in that list to match - which reads as
   * the mission being gone rather than as being one chip away.
   */
  const SETTLED = [
    { id: 'z', name: 'Rocky Square Attempt', code: 'rover.forward(60)', status: 'completed' as const },
    { id: 'y', name: 'Abandoned Run', code: 'rover.stop()', status: 'cancelled' as const },
  ];

  it('finds a completed mission from the default queue filter', () => {
    renderQueue(QUEUE, SETTLED);

    fireEvent.change(screen.getByLabelText(/search missions/i), {
      target: { value: 'Rocky' },
    });

    expect(screen.getByText('Rocky Square Attempt')).toBeInTheDocument();
  });

  it('finds a cancelled mission, which is in neither list by status', () => {
    // Cancel keeps the record on purpose. It has to be reachable.
    renderQueue(QUEUE, SETTLED);

    fireEvent.change(screen.getByLabelText(/search missions/i), {
      target: { value: 'Abandoned' },
    });

    expect(screen.getByText('Abandoned Run')).toBeInTheDocument();
  });

  it('still narrows to the query, rather than showing everything', () => {
    renderQueue(QUEUE, SETTLED);

    fireEvent.change(screen.getByLabelText(/search missions/i), {
      target: { value: 'Rocky' },
    });

    expect(screen.queryByText('Rock Lover')).not.toBeInTheDocument();
    expect(screen.queryByText('Abandoned Run')).not.toBeInTheDocument();
  });

  it('does not mix the settled list in when nothing is typed', () => {
    // The queue is work waiting. A finished mission appearing in it would be
    // a worse bug than the one being fixed.
    renderQueue(QUEUE, SETTLED);

    expect(screen.queryByText('Rocky Square Attempt')).not.toBeInTheDocument();
    expect(screen.getByText('Rock Lover')).toBeInTheDocument();
  });
});


describe('the Done chip does not claim the yard has nothing finished', () => {
  /**
   * Seen on a live console: "All in queue 16" beside "Done 0", at a yard that
   * had 25 finished missions sitting behind that chip. The settled list is
   * only fetched when it is selected or searched, and the unfetched state was
   * rendered as the number 0 - which does not read as "not loaded", it reads
   * as "nothing has ever finished here". Together the two chips said the yard
   * had 16 missions in total.
   */
  function doneChip() {
    return screen.getAllByRole('button', { name: /done/i })[0];
  }

  it('shows no number before the list has been fetched', () => {
    renderQueue(QUEUE, [
      { id: 'z', name: 'Rocky Square Attempt', code: '', status: 'completed' as const },
    ]);

    // Asserted on the raw text, and against ANY digit.
    //
    // The first version of this checked /\b0\b/, which never matches: the chip
    // renders as "Done0" with no word boundary between the "e" and the "0", so
    // it passed against the very bug it was written for. Caught by putting the
    // bug back and watching the test stay green.
    expect(doneChip().textContent).not.toMatch(/\d/);
  });

  it('shows the real number once the list is open', () => {
    renderQueue(QUEUE, [
      { id: 'z', name: 'Rocky Square Attempt', code: '', status: 'completed' as const },
      { id: 'y', name: 'Abandoned Run', code: '', status: 'cancelled' as const },
    ]);

    fireEvent.click(doneChip());

    expect(doneChip().textContent).toMatch(/2/);
  });

  it('still shows a real zero for a filter that HAS counted itself', () => {
    // "Needs review 0" is a fact the operator can act on, and hiding it would
    // be the opposite bug. Only the queue's own missions are passed, none of
    // which needs review, so the zero here is genuine rather than unfetched.
    renderQueue([QUEUE[0]]);

    expect(screen.getAllByRole('button', { name: /needs review/i })[0])
      .toHaveTextContent('0');
  });
});
