/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';

jest.mock('@/lib/yardConsole', () => ({
  ...jest.requireActual('@/lib/yardConsole'),
  readConsoleUrl: () => 'http://curiosity.local:3001/run/',
}));

const mission = {
  id: 'm1',
  name: 'Rock Lover',
  code: 'rover.forward(60)',
  status: 'queued' as const,
  submittedAt: '2026-09-01T08:00:00Z',
};

const status = (overrides: Record<string, unknown> = {}) => ({
  camera: { ready: true },
  rover: { reachable: true, status: 'ok' },
  recording: { ready: true },
  ...overrides,
});

const answer = (body: unknown) => ({ ok: true, json: async () => body });

const sendButton = () => screen.getByRole('button', { name: 'Send to Rover' });

function mount(navigate = jest.fn()) {
  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={navigate} />);
  return navigate;
}

async function checkYard() {
  fireEvent.click(await screen.findByRole('button', { name: 'Check yard' }));
}

beforeEach(() => {
  jest.restoreAllMocks();
});

/**
 * This page has no local network permission to consult (jsdom, like a plain
 * http page), so nothing reads the yard until Check yard is pressed.
 */
describe('Automatic Route dispatch', () => {
  it('keeps Send to Rover locked until the yard has been read', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    mount();

    expect(await screen.findByRole('button', { name: 'Check yard' })).toBeEnabled();
    expect(sendButton()).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows every check that is not ready, with its fix, and keeps Send to Rover locked', async () => {
    const fetchMock = jest.fn().mockResolvedValue(answer(status({
      camera: { ready: false, detail: 'camera server is not running' },
      rover: { reachable: false, status: null },
    })));
    global.fetch = fetchMock;
    const navigate = mount();

    await checkYard();

    const notReady = await screen.findByTestId('yard-not-ready');
    expect(notReady).toHaveTextContent('Camera');
    expect(notReady).toHaveTextContent('Rover');
    expect(notReady).not.toHaveTextContent('Recording');
    expect(sendButton()).toBeDisabled();
    // Nothing was sent, so there is nothing to call a failed send.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Yard offline')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('unlocks Send to Rover when every check is ready, and sends only when it is pressed', async () => {
    const fetchMock = jest.fn().mockResolvedValue(answer(status()));
    global.fetch = fetchMock;
    const navigate = mount();

    await checkYard();
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(sendButton());
    expect(await screen.findByRole('status')).toHaveTextContent('Starting mission');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });

    // Pressing it read the yard again rather than trusting the earlier check.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(1);
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.pathname).toBe('/run/');
    expect(target.searchParams.get('handoff')).toBe('automatic');
    expect(target.searchParams.get('yardId')).toBe('curiosity');
    expect(target.searchParams.get('missionId')).toBe('m1');
    expect(target.searchParams.get('code')).toBe(mission.code);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://curiosity.local:3001/api/status',
      expect.objectContaining({ cache: 'no-store' }),
    );
  }, 10000);

  it('does not send when the yard stopped being ready between the check and the press', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(answer(status()))
      .mockResolvedValue(answer(status({ camera: { ready: false, detail: 'camera server is not running' } })));
    const navigate = mount();

    await checkYard();
    await waitFor(() => expect(sendButton()).toBeEnabled());
    fireEvent.click(sendButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Camera');
    expect(dialog).toHaveTextContent('NOT been sent');
    expect(sendButton()).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says the yard is offline, and points at copy and paste, when it cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const navigate = mount();

    await checkYard();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Yard offline');
    expect(alert).toHaveTextContent('run station');
    // The browser's own error text is not what the operator reads.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('copies the mission from the offline message', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    mount();
    await checkYard();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy for the run station' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# MissionID: m1')),
    );
  });

  it('calls a yard that never answers offline, instead of spinning forever', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ) as unknown as typeof fetch;

      mount();
      await act(async () => {});
      await checkYard();
      // Let the permission lookup settle so the request, and its timer, exist.
      await act(async () => {});

      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });

      expect(await screen.findByRole('alert')).toHaveTextContent('Yard offline');
    } finally {
      jest.useRealTimers();
    }
  });

  describe('with a local network access permission (Chrome, Edge)', () => {
    let permission: { state: PermissionState; onchange: (() => void) | null };

    beforeEach(() => {
      permission = { state: 'granted', onchange: null };
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: {
          query: jest.fn(async ({ name }: { name: string }) => {
            if (name !== 'local-network') throw new TypeError('unknown permission');
            return permission;
          }),
        },
      });
    });

    afterEach(() => {
      delete (navigator as { permissions?: unknown }).permissions;
    });

    it('says where to allow it as soon as the mission opens, without asking the yard', async () => {
      permission.state = 'denied';
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      mount();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Local network access is blocked');
      expect(alert).not.toHaveTextContent('Yard offline');
      expect(screen.getByRole('button', { name: 'Copy for the run station' })).toBeInTheDocument();
      expect(sendButton()).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('says it is blocked when the operator refuses the prompt', async () => {
      permission.state = 'prompt';
      global.fetch = jest.fn(async () => {
        permission.state = 'denied';
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;

      mount();
      await checkYard();

      expect(await screen.findByRole('alert')).toHaveTextContent('Local network access is blocked');
    });

    it('does not call the yard offline while the operator is still answering the prompt', async () => {
      jest.useFakeTimers();
      try {
        permission.state = 'prompt';
        global.fetch = jest.fn(
          (_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }),
        ) as unknown as typeof fetch;

        mount();
        await act(async () => {});
        await checkYard();
        await act(async () => {});

        // Longer than the yard's own limit, with the prompt still open.
        await act(async () => {
          jest.advanceTimersByTime(30_000);
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        // The operator allows it; now the yard gets its ten seconds.
        await act(async () => {
          permission.state = 'granted';
          permission.onchange?.();
        });
        await act(async () => {
          jest.advanceTimersByTime(9_000);
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await act(async () => {
          jest.advanceTimersByTime(1_000);
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('Yard offline');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
