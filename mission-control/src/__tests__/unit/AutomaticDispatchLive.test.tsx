/**
 * @jest-environment jsdom
 */

/**
 * An open mission keeps its yard checks current, so the operator sees the
 * camera go red before pressing Send to Rover rather than after. The reads go
 * from the browser to the satellite, so they cost the Pi a little and nothing
 * in the cloud; these pin down when they must not happen.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

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

const ready = { camera: { ready: true }, rover: { reachable: true, status: 'ok' }, recording: { ready: true } };
const cameraDown = { ...ready, camera: { ready: false, detail: 'camera server is not running' } };

let permission: { state: PermissionState; onchange: (() => void) | null };
let hidden = false;

function answer(body: unknown) {
  return { ok: true, json: async () => body };
}

/** Let the permission lookup and any read in flight settle. */
async function settle() {
  await act(async () => {});
  await act(async () => {});
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

function chip(label: string) {
  return screen.getByText(label).parentElement!;
}

beforeEach(() => {
  jest.useFakeTimers();
  permission = { state: 'granted', onchange: null };
  hidden = false;
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn(async () => permission) },
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  jest.useRealTimers();
  delete (navigator as { permissions?: unknown }).permissions;
});

it('shows the checks as soon as a mission opens, without sending anything', async () => {
  global.fetch = jest.fn().mockResolvedValue(answer(ready));
  const navigate = jest.fn();

  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={navigate} />);
  await settle();

  expect(global.fetch).toHaveBeenCalledWith('http://curiosity.local:3001/api/status', expect.anything());
  expect(chip('Camera')).toHaveTextContent('Ready');
  expect(chip('Recording')).toHaveTextContent('Ready');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  await wait(2_000);
  expect(navigate).not.toHaveBeenCalled();
});

it('reads them again every 15 seconds', async () => {
  const fetchMock = jest.fn().mockResolvedValueOnce(answer(ready)).mockResolvedValue(answer(cameraDown));
  global.fetch = fetchMock;

  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  await settle();
  expect(chip('Camera')).toHaveTextContent('Ready');

  await wait(14_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await wait(1_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(chip('Camera')).toHaveTextContent('camera server is not running');
});

it('does not read while the tab is in the background, and catches up when it returns', async () => {
  const fetchMock = jest.fn().mockResolvedValue(answer(ready));
  global.fetch = fetchMock;

  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  hidden = true;
  await wait(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  hidden = false;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not reach for the yard on opening when the browser would have to ask first', async () => {
  // Opening a mission must not pop a permission prompt nobody asked for.
  permission.state = 'prompt';
  const fetchMock = jest.fn().mockResolvedValue(answer(ready));
  global.fetch = fetchMock;

  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  await settle();
  await wait(30_000);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(chip('Camera')).toHaveTextContent('Not checked');
});

it('starts reading once Send to Rover has reached the yard', async () => {
  permission.state = 'prompt';
  const fetchMock = jest.fn().mockResolvedValue(answer(cameraDown));
  global.fetch = fetchMock;

  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Send to Rover' }));
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await wait(15_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('stops reading when the mission is closed', async () => {
  const fetchMock = jest.fn().mockResolvedValue(answer(ready));
  global.fetch = fetchMock;

  const { unmount } = render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  await settle();
  unmount();
  await wait(60_000);

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('marks the checks as unanswered when the yard stops answering', async () => {
  const fetchMock = jest.fn().mockResolvedValueOnce(answer(ready)).mockRejectedValue(new TypeError('Failed to fetch'));
  global.fetch = fetchMock;

  render(<AutomaticDispatch mission={mission} yardId="curiosity" navigate={jest.fn()} />);
  await settle();
  await wait(15_000);

  expect(chip('Camera')).toHaveTextContent('No answer');
  // A background read reports; only pressing Send to Rover raises an alert.
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
