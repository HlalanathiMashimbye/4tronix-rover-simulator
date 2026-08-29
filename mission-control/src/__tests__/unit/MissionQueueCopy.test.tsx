/**
 * @jest-environment jsdom
 */

/**
 * The copy-to-yard bridge (David, 2026-08-27 standup).
 *
 * Mission Control cannot reach the satellite - it sits behind carrier NAT with
 * no inbound path, which is why Firestore is the only channel between them. So
 * the operator keeps both open in tabs, copies the Python from the queue, and
 * pastes it into the yard's code editor to run.
 *
 * A fallback that should survive automated dispatch rather than be replaced by
 * it: this is the path that still works when the venue's internet does not.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const subscribeToYardQueue = jest.fn();

jest.mock('@/lib/services/operatorQueueService', () => ({
  subscribeToYardQueue: (...args: unknown[]) => subscribeToYardQueue(...args),
}));

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blockly" />,
}));

import { MissionQueue } from '@/components/operator/MissionQueue';

const MISSION = {
  id: 'm1',
  name: 'Rock Lover',
  code: 'rover.forward(60)\nrover.stop()',
  status: 'queued' as const,
  submittedAt: '2026-08-27T08:00:00Z',
};

function emitQueue(missions = [MISSION]) {
  subscribeToYardQueue.mockImplementation((_yard, onMissions) => {
    onMissions(missions);
    return () => {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  emitQueue();
});

describe('copying a mission to paste into the yard', () => {
  it('puts the mission Python on the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MissionQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /copy/i }));

    // waitFor, not a bare assertion: the copy is async and sets state after it
    // resolves, so asserting synchronously both races the write and leaves an
    // act() warning behind.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('rover.forward(60)\nrover.stop()'),
    );
    await screen.findByRole('button', { name: /copied/i });
  });

  it('confirms, so the operator knows to switch tabs', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });

    render(<MissionQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /copy/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument());
  });

  it('falls back to a prompt when the clipboard is refused', async () => {
    // Clipboard access is denied on insecure origins. Showing "Copied" over an
    // empty clipboard would send an operator to paste nothing into the yard.
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    });
    const prompt = jest.spyOn(window, 'prompt').mockReturnValue(null);

    render(<MissionQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /copy/i }));

    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(expect.stringContaining('paste it into the yard'), MISSION.code),
    );
    expect(screen.queryByRole('button', { name: /copied/i })).not.toBeInTheDocument();
  });

  it('cannot copy a mission with no code', async () => {
    emitQueue([{ ...MISSION, code: '' }]);

    render(<MissionQueue />);

    expect(await screen.findByRole('button', { name: /copy/i })).toBeDisabled();
  });
});
