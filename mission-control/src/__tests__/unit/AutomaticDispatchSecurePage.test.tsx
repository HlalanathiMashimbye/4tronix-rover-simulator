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

import { render, screen } from '@testing-library/react';

import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';

jest.mock('@/lib/yardConsole', () => ({
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

function open() {
  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
}

it('runs on an https page', () => {
  // The cases below mean nothing if the docblock URL stopped applying.
  expect(window.location.protocol).toBe('https:');
});

it('tells a browser with no local network permission to use Chrome or Edge as soon as the mission opens', async () => {
  // Safari: no permission to ask for, so a request would simply be blocked.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockRejectedValue(new TypeError('unknown permission')) },
  });
  const fetchMock = jest.fn().mockRejectedValue(new TypeError('Load failed'));
  global.fetch = fetchMock;

  open();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('This browser cannot reach the yard');
  expect(alert).toHaveTextContent('Chrome or Edge');
  expect(alert).not.toHaveTextContent('Yard offline');
  expect(screen.getByRole('button', { name: 'Copy for the run station' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send to Rover' })).toBeDisabled();
  // Neither trying again nor checking can change which browser this is.
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check yard' })).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
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
