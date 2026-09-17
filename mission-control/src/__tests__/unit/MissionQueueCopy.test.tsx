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

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const subscribeToYardQueue = jest.fn();

jest.mock('@/infrastructure/persistence/operatorQueueService', () => ({
  subscribeToYardQueue: (...args: unknown[]) => subscribeToYardQueue(...args),
  // Selecting a mission subscribes to its runs across yards. Not what these
  // tests are about, so it is a no-op unsubscribe.
  subscribeToMissionRuns: () => () => {},
  // Selecting also watches the mission's own document, so it survives
  // leaving the queue. These tests read the lists, so it stays quiet.
  subscribeToMission: () => () => {},
}));

jest.mock('@/components/mission/BlocklyViewer', () => ({
  BlocklyViewer: () => <div data-testid="blockly" />,
}));

import { MissionQueue } from '@/components/operator/MissionQueue';
import { SearchProvider } from '@/contexts/SearchContext';

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
  // The console address is per-browser and persists, so without this the
  // tests below would only pass in the order they happen to be written in.
  localStorage.clear();
});

/** Each queued mission is one row, and the row is the way into it. */
async function openMission() {
  fireEvent.click(await screen.findByRole('button', { name: /rock lover/i }));
}

describe('a queued mission', () => {
  it('opens from its row, which carries no buttons of its own', async () => {
    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const row = await screen.findByRole('button', { name: /rock lover/i });
    // The row had its own Send to Rover and Open buttons, so one mission showed
    // two Send to Rover buttons: the row's and the mission pane's.
    expect(screen.queryByRole('button', { name: /send to rover/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^open$/i })).not.toBeInTheDocument();

    fireEvent.click(row);

    expect(await screen.findAllByRole('button', { name: /send to rover/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^copy mission code$/i })).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('puts sending above the actions that only change the record', async () => {
    // Record actions first put their "does not reach the rover" note directly
    // above Send to Rover, which read as if sending did not reach it either.
    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);
    await openMission();

    const send = await screen.findByRole('button', { name: /send to rover/i });
    const complete = screen.getByRole('button', { name: /mark complete/i });
    expect(send.compareDocumentPosition(complete) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opening a mission does not start sending it', async () => {
    // The row's Send to Rover used to open the pane AND start the yard checks.
    // Opening is now only opening: nothing is asked of the satellite until the
    // operator presses the pane's button.
    const fetchSpy = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;

    try {
      render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);
      await openMission();
      await screen.findByRole('button', { name: /send to rover/i });

      // The console reads the upload checker's status on its own; that is not
      // the yard, and not a send.
      const calls = fetchSpy.mock.calls.map(([url]) => String(url));
      expect(calls.filter((url) => url !== '/api/operator/youtube-link')).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('copying a mission to paste into the yard', () => {

  it('puts the mission Python on the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);
    await openMission();
    fireEvent.click(await screen.findByRole('button', { name: /^copy mission code$/i }));

    // waitFor, not a bare assertion: the copy is async and sets state after it
    // resolves, so asserting synchronously both races the write and leaves an
    // act() warning behind.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '# Mission: Rock Lover\n# MissionID: m1\n\nrover.forward(60)\nrover.stop()',
      ),
    );
    await screen.findByRole('button', { name: /^copied$/i });
  });

  it('confirms, so the operator knows to switch tabs', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);
    await openMission();
    fireEvent.click(await screen.findByRole('button', { name: /^copy mission code$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^copied$/i })).toBeInTheDocument());
  });

  it('falls back to a prompt when the clipboard is refused', async () => {
    // Clipboard access is denied on insecure origins. Showing "Copied" over an
    // empty clipboard would send an operator to paste nothing into the yard.
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    });
    const prompt = jest.spyOn(window, 'prompt').mockReturnValue(null);

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);
    await openMission();
    fireEvent.click(await screen.findByRole('button', { name: /^copy mission code$/i }));

    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith(
        expect.stringContaining('paste it into the yard'),
        '# Mission: Rock Lover\n# MissionID: m1\n\nrover.forward(60)\nrover.stop()',
      ),
    );
    expect(screen.queryByRole('button', { name: /^copied$/i })).not.toBeInTheDocument();
  });

  it('cannot copy a mission with no code', async () => {
    emitQueue([{ ...MISSION, code: '' }]);

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    await openMission();
    expect(await screen.findByRole('button', { name: /^copy mission code$/i })).toBeDisabled();
  });
});

describe('the door to the operator console', () => {
  it('offers a link to the yard console, defaulting to the satellite', async () => {
    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const link = await screen.findByRole('link', { name: /operator console/i });

    expect(link).toHaveAttribute('href', 'http://mro.local:3001/run/');
    // The queue is what the operator works from; losing it to navigate away
    // mid-shift would mean signing back in.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('reads as a primary action rather than a ghost link', async () => {
    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const link = await screen.findByRole('link', { name: /operator console/i });

    expect(link.className).toContain('bg-gradient-mars');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it('remembers a different address for this browser', async () => {
    // The console is on a private network in the room, so its address is a
    // property of where the operator is, not of the deployment.
    localStorage.setItem('yard:consoleUrl', 'http://192.168.137.1:3001/run/');

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const link = await screen.findByRole('link', { name: /operator console/i });
    expect(link).toHaveAttribute('href', 'http://192.168.137.1:3001/run/');
  });

  it('ignores a stored address that is not safe to open', async () => {
    localStorage.setItem('yard:consoleUrl', 'javascript://mro.local/%0aalert(1)');

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const link = await screen.findByRole('link', { name: /operator console/i });
    expect(link).toHaveAttribute('href', 'http://mro.local:3001/run/');
  });
});

describe('the door to YouTube Studio', () => {
  const mount = () =>
    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

  it('is unmistakably YouTube, not another grey link in a row of them', async () => {
    // It was a bordered ghost link among bordered ghost links, so the step
    // ended in something the operator had to hunt for.
    mount();

    const link = await screen.findByRole('link', { name: /youtube studio/i });

    expect(link).toHaveStyle({ backgroundColor: '#E60000' });
    expect(link.className).toContain('text-white');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it('links to Studio, where the run video gets uploaded', async () => {
    mount();

    const link = await screen.findByRole('link', { name: /youtube studio/i });

    expect(link).toHaveAttribute('href', 'https://studio.youtube.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('stays put while the console address is being edited', async () => {
    // Both are doors the operator needs; changing where one goes should not
    // take the other off the screen.
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^change$/i }));

    expect(await screen.findByRole('link', { name: /youtube studio/i })).toBeInTheDocument();
    // And the console link really is the thing that went away.
    expect(screen.queryByRole('link', { name: /operator console/i })).not.toBeInTheDocument();
  });
});

describe('the operator console gives the mission pane its height', () => {
  it('keeps the console address off the toolbar until there is room for it', async () => {
    /**
     * The queue column is narrower than the mission pane on purpose, so this
     * toolbar has to stay on one line - a second line here comes straight out
     * of the queue below it. The address is the informational part and the
     * first thing to drop; the button works without anyone reading it.
     *
     * 2xl, not xl: at exactly 1280 the address reappears while the column is
     * still too narrow, which is the width that actually wrapped.
     */
    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const link = await screen.findByRole('link', { name: /operator console/i });
    const address = link.parentElement!.querySelector('span.font-mono')!;

    expect(address.className).toContain('hidden');
    expect(address.className).toContain('2xl:inline');
  });

  it('gives the mission pane more width than the queue', async () => {
    // The queue is a list of short rows; the pane holds the code and blocks.
    const { container } = render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);
    await screen.findByRole('link', { name: /operator console/i });

    const grid = container.querySelector('[class*="lg:grid-cols-"]')!;
    expect(grid.className).toContain('0.85fr');
    expect(grid.className).toContain('1.15fr');
  });
});

describe('whether uploads are being checked', () => {
  it('sits directly under the YouTube Studio button, at every width', async () => {
    /**
     * It was `hidden 2xl:inline`, which hid it on every laptop, and then a row
     * of its own across the toolbar, which read as bolted on. It belongs to
     * the button, so it hangs under it.
     */
    const { forgetSharedReading } = jest.requireActual('@/hooks/useYouTubeLinkStatus');
    forgetSharedReading();
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, lastCheckedAt: new Date().toISOString(), intervalMinutes: 15 }),
    }) as unknown as typeof fetch;

    try {
      render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

      const door = await screen.findByTestId('youtube-studio-door');
      const status = await within(door).findByText(/Next check/);
      const button = within(door).getByRole('link', { name: /youtube studio/i });

      expect(button.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Nothing between here and the door hides it at any breakpoint.
      for (let el: HTMLElement | null = status; el && el !== door.parentElement; el = el.parentElement) {
        expect(el.className.split(' ')).not.toContain('hidden');
      }
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('coming back from the yard console', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('opens the mission the operator sent', async () => {
    window.history.replaceState(null, '', '/operator?mission=m1');

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const row = await screen.findByRole('button', { name: /rock lover/i });
    await waitFor(() => expect(row).toHaveAttribute('aria-current', 'true'));
    // Dropped once read, so a refresh after choosing another mission does not
    // reopen this one.
    expect(window.location.search).toBe('');
  });

  it('opens nothing when it did not come back from the yard', async () => {
    window.history.replaceState(null, '', '/operator');

    render(<SearchProvider><MissionQueue role="operator" yardId="curiosity" yardName="Cape Town Science Centre, Observatory" yards={[]} /></SearchProvider>);

    const row = await screen.findByRole('button', { name: /rock lover/i });
    expect(row).not.toHaveAttribute('aria-current', 'true');
  });
});
