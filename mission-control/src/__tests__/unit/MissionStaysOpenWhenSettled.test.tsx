/**
 * @jest-environment jsdom
 */

/**
 * Marking a mission complete must not lose it.
 *
 * Reported from the console: "when I mark a mission complete it disappears
 * into Done and I have to look for them again."
 *
 * Every list in the console is a window, and a mission leaves its window the
 * moment its status changes. Completing one dropped it out of the queue while
 * the operator was still looking at it, and the detail pane went blank - at
 * exactly the point their next job was attaching the recording.
 *
 * Reading it back from the settled list would not have fixed it: that list is
 * capped at 25 and ordered by SUBMISSION, so a mission submitted this morning
 * and completed now can settle outside the window and be unreachable there
 * too. The open mission is watched on its own document instead.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';

const subscribeToYardQueue = jest.fn();
const subscribeToYardCompleted = jest.fn();
const subscribeToMission = jest.fn();

jest.mock('@/infrastructure/persistence/operatorQueueService', () => ({
  subscribeToYardQueue: (...a: unknown[]) => subscribeToYardQueue(...a),
  subscribeToYardCompleted: (...a: unknown[]) => subscribeToYardCompleted(...a),
  subscribeToMission: (...a: unknown[]) => subscribeToMission(...a),
  subscribeToMissionRuns: () => () => {},
}));

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blockly" />,
}));

import { MissionQueue } from '@/components/operator/MissionQueue';
import { SearchProvider } from '@/contexts/SearchContext';

const QUEUED = {
  id: 'm1',
  name: 'Rock Lover',
  code: 'rover.forward(60)',
  status: 'queued' as const,
  submittedAt: '2026-09-01T08:00:00Z',
};

/** Push a new version of the watched document, as Firestore would. */
let pushMission: (m: unknown) => void = () => {};
/** Drop the mission from the queue, as completing it does. */
let pushQueue: (m: unknown[]) => void = () => {};

beforeEach(() => {
  jest.clearAllMocks();

  subscribeToYardQueue.mockImplementation((_yard, onMissions) => {
    pushQueue = (m) => act(() => onMissions(m));
    onMissions([QUEUED]);
    return () => {};
  });
  // Not subscribed on this filter, which is the whole problem: the settled
  // list is not there to fall back on.
  subscribeToYardCompleted.mockImplementation((_yard, onMissions) => {
    onMissions([]);
    return () => {};
  });
  subscribeToMission.mockImplementation((_id, onMission) => {
    pushMission = (m) => act(() => onMission(m));
    onMission(QUEUED);
    return () => {};
  });
});

function open() {
  render(
    <SearchProvider>
      <MissionQueue role="operator" yardId="curiosity" yardName="Cape Town" yards={[]} />
    </SearchProvider>,
  );
  fireEvent.click(screen.getByText('Rock Lover'));
}

describe('a mission that settles while it is open', () => {
  it('stays on screen after it leaves the queue', () => {
    open();

    // Completing it: the document changes status, and the queue drops it.
    pushMission({ ...QUEUED, status: 'completed' });
    pushQueue([]);

    // Still there. Before this it went blank and the operator had to go
    // hunting under Done.
    expect(screen.getAllByText('Rock Lover').length).toBeGreaterThan(0);
  });

  it('reflects the new status, not the one it was opened with', () => {
    /**
     * Asserted through the actions rather than a status label, because that is
     * what the status actually drives: MissionActions hides Mark complete and
     * Cancel once a mission has settled. A pane holding a stale copy would go
     * on offering to complete a mission that already had.
     */
    open();
    expect(screen.getByRole('button', { name: /mark complete/i })).toBeInTheDocument();

    pushMission({ ...QUEUED, status: 'completed' });
    pushQueue([]);

    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
  });

  it('is watched by its own id', () => {
    open();

    expect(subscribeToMission).toHaveBeenCalledWith(
      'm1',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('does not watch anything until a mission is opened', () => {
    // One listener per open mission, not one per mission in the queue.
    render(
      <SearchProvider>
        <MissionQueue role="operator" yardId="curiosity" yardName="Cape Town" yards={[]} />
      </SearchProvider>,
    );

    expect(subscribeToMission).not.toHaveBeenCalled();
  });

  it('closes the pane when the mission is actually gone', () => {
    // null means deleted or missing, which is different from "not loaded".
    // Holding the last known copy on screen would show work that no longer
    // exists, and the actions on it would all fail.
    open();

    pushMission(null);
    pushQueue([]);

    expect(screen.queryByText('Rock Lover')).not.toBeInTheDocument();
  });
});
