/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://staging.example/operator"}
 */

/**
 * Mission Control on the deployed site is an https page, and the satellite is
 * an http address on the yard network. Whether the browser lets one call the
 * other depends on the browser, so these run on an https page: the operator
 * testing in Safari was told the yard was offline while it was fine.
 */

import { fireEvent, render, screen } from '@testing-library/react';

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

function sendToRover() {
  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));
}

it('runs on an https page', () => {
  // The cases below mean nothing if the docblock URL stopped applying.
  expect(window.location.protocol).toBe('https:');
});

it('points a browser with no local network permission at Chrome or Edge, not at the yard', async () => {
  // Safari: no permission to ask for, so the request is simply blocked.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockRejectedValue(new TypeError('unknown permission')) },
  });
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Load failed'));

  sendToRover();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('This browser cannot reach the yard');
  expect(alert).toHaveTextContent('Chrome or Edge');
  expect(alert).not.toHaveTextContent('Yard offline');
  expect(screen.getByRole('button', { name: 'Copy for the run station' })).toBeInTheDocument();
});

it('still calls the yard offline when the browser was allowed to reach it', async () => {
  // Chrome with local network access allowed: a failure here is the yard.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockResolvedValue({ state: 'granted', onchange: null }) },
  });
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

  sendToRover();

  expect(await screen.findByRole('alert')).toHaveTextContent('Yard offline');
});
