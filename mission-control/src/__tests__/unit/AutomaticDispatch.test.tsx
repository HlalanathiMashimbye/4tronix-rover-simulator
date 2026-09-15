/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('navigates with the mission and yard only after all checks pass', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => status() });
    global.fetch = fetchMock;
    const assign = jest.fn();

    render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={assign} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const target = new URL(assign.mock.calls[0][0]);
    expect(target.pathname).toBe('/run/');
    expect(target.searchParams.get('handoff')).toBe('automatic');
    expect(target.searchParams.get('yardId')).toBe('curiosity');
    expect(target.searchParams.get('missionId')).toBe('m1');
    expect(target.searchParams.get('code')).toBe(mission.code);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://curiosity.local:3001/api/status',
      { cache: 'no-store' },
    );
  });
});