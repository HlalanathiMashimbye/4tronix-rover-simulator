/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://staging.example/operator"}
 */

/**
 * Mission Control on the deployed site is an https page, and the satellite is
 * an http address on the yard network. Whether the browser lets one call the
 * other depends on the browser, so these run on an https page: the operator
 * testing in Safari was told the yard was offline while it was fine, and only
 * after pressing Send to Rover.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';

jest.mock('@/lib/yardConsole', () => ({
  ...jest.requireActual('@/lib/yardConsole'),
  readConsoleUrl: () => 'http://mro.local:3001/run/',
}));

const mission = {
  id: 'm1',
  name: 'Rock Lover',
  code: 'rover.forward(60)',
  status: 'queued' as const,
  submittedAt: '2026-09-01T08:00:00Z',
};

afterEach(() => {
  delete (navigator as { permissions?: unknown }).permissions;
});

function open(navigate: (url: string) => void = jest.fn()) {
  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={navigate} />);
}

it('runs on an https page', () => {
  // The cases below mean nothing if the docblock URL stopped applying.
  expect(window.location.protocol).toBe('https:');
});

describe('a browser that blocks the yard check: Safari, Firefox, any iPhone browser', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // No permission to ask for, so a request would simply be blocked.
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn().mockRejectedValue(new TypeError('unknown permission')) },
    });
    fetchMock = jest.fn().mockRejectedValue(new TypeError('Load failed'));
    global.fetch = fetchMock;
  });

  it('says so as soon as the mission opens, without trying a read that cannot work', async () => {
    open();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This browser cannot check the yard');
    expect(alert).not.toHaveTextContent('Yard offline');
    expect(alert).not.toHaveTextContent('Chrome or Edge');
    expect(screen.getByRole('button', { name: 'Copy for the run station' })).toBeInTheDocument();
    // Neither trying again nor checking can change which browser this is.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check yard' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still sends: Send to Rover opens the run station with the mission, which checks the yard itself', async () => {
    const navigate = jest.fn();
    open(navigate);
    await screen.findByRole('alert');

    const send = screen.getByRole('button', { name: 'Send to Rover' });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(await screen.findByRole('status')).toHaveTextContent('Opening the run station');
    expect(send).toBeDisabled();
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const target = new URL(navigate.mock.calls[0][0]);
    expect(target.origin + target.pathname).toBe('http://mro.local:3001/run/');
    expect(target.searchParams.get('handoff')).toBe('automatic');
    expect(target.searchParams.get('yardId')).toBe('curiosity');
    expect(target.searchParams.get('missionId')).toBe('m1');
    expect(target.searchParams.get('code')).toBe('rover.forward(60)');
    // Straight there: no read of the yard was attempted on the way.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Chrome that cannot name the permission in advance, as on Android', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { brands: [{ brand: 'Chromium', version: '142' }, { brand: 'Google Chrome', version: '142' }] },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn().mockRejectedValue(new TypeError('unknown permission')) },
    });
  });

  afterEach(() => {
    delete (navigator as { userAgentData?: unknown }).userAgentData;
  });

  it('offers Check yard, whose request is what lets Chrome ask', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ yardId: 'curiosity', camera: { ready: true }, rover: { ok: true }, recording: { ready: true } }),
    });
    global.fetch = fetchMock;

    open();
    // Check yard is on the page before the opening permission check answers,
    // so wait for that answer: it is what used to take the button away.
    const query = (navigator as unknown as { permissions: { query: jest.Mock } }).permissions.query;
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    await act(async () => {});

    const check = screen.getByRole('button', { name: 'Check yard' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(check);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://mro.local:3001/api/status', expect.anything()));
  });

  it('never tells a Chrome user to open Chrome when the request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Check yard' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Yard offline');
    expect(alert).not.toHaveTextContent('Chrome or Edge');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

it('still calls the yard offline when the browser was allowed to reach it', async () => {
  // Chrome with local network access allowed: a failure here is the yard.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockResolvedValue({ state: 'granted', onchange: null }) },
  });
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

  open();

  expect(await screen.findByRole('alert')).toHaveTextContent('Yard offline');
  expect(screen.getByRole('button', { name: 'Send to Rover' })).toBeDisabled();
});
