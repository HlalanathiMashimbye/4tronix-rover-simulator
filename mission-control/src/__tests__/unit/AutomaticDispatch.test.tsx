/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';

jest.mock('@/lib/yardConsole', () => ({
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

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('Automatic Route dispatch', () => {
  it('shows every failed check and does not navigate', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => status({
        camera: { ready: false, detail: 'camera server is not running' },
        rover: { reachable: false, status: null },
      }),
    });
    global.fetch = fetchMock;
    const assign = jest.fn();

    render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={assign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Camera');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Rover');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('NOT been sent');
    // The yard answered, so this is a checks problem, not an offline yard.
    expect(screen.queryByText('Yard offline')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('says the yard is offline, and points at copy and paste, when it cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const assign = jest.fn();

    render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={assign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Yard offline');
    expect(alert).toHaveTextContent('run station');
    // Nothing was checked, so there is no list of failed checks, and the
    // browser's own error text is not what the operator reads.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('copies the mission from the offline message', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));
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

      render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));
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

    it('says where to allow it when it is blocked, and does not ask the yard', async () => {
      permission.state = 'denied';
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Local network access is blocked');
      expect(alert).not.toHaveTextContent('Yard offline');
      expect(screen.getByRole('button', { name: 'Copy for the run station' })).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('says it is blocked when the operator refuses the prompt', async () => {
      permission.state = 'prompt';
      global.fetch = jest.fn(async () => {
        permission.state = 'denied';
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;

      render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));

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

        render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));
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

  it('navigates with the mission and yard only after all checks pass', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(status()) });
    global.fetch = fetchMock;
    const assign = jest.fn();

    render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={assign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Starting mission');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    expect(assign).toHaveBeenCalledTimes(1);
    const target = new URL(assign.mock.calls[0][0]);
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
});