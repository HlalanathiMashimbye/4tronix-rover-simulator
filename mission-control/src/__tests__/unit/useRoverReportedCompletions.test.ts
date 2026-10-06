/**
 * @jest-environment jsdom
 */

/**
 * Mark complete was greyed out on the promise that the rover reports when it
 * finished, and nothing listened. These pin down that the open console now
 * does, and only in the ways that cannot surprise an operator.
 */

import { act, renderHook } from '@testing-library/react';

import { COMPLETION_POLL_MS, useRoverReportedCompletions } from '@/hooks/useRoverReportedCompletions';
import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';

jest.mock('@/lib/yardConsole', () => ({
  ...jest.requireActual('@/lib/yardConsole'),
  readConsoleUrl: () => 'http://mro.local:3001/run/',
}));

const queued = (id: string, name = id): QueueMission => ({ id, name, code: 'rover.forward(60)', status: 'queued' });

const roverHistory = (...entries: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ current: null, pending: [], history: entries }),
});

let permission: { state: PermissionState };
let hidden = false;

function fetchWith(history: ReturnType<typeof roverHistory>, completeStatus = 200) {
  return jest.fn(async (url: string) => {
    if (url.endsWith('/api/queue/status')) return history;
    return { ok: completeStatus < 400, status: completeStatus, json: async () => ({ success: completeStatus < 400 }) };
  });
}

const completions = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/operator/missions/'));

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {});
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  permission = { state: 'granted' };
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

function listen(missions: QueueMission[], onCompleted = jest.fn()) {
  renderHook(() => useRoverReportedCompletions({ yardId: 'curiosity', missions, onCompleted }));
  return onCompleted;
}

it('marks a queued mission complete when the rover reports it finished', async () => {
  const fetchMock = fetchWith(roverHistory({ id: 'i1', status: 'completed', params: { mission_id: 'm1' } }));
  global.fetch = fetchMock as unknown as typeof fetch;

  const onCompleted = listen([queued('m1', 'Rock Lover')]);
  await settle();

  expect(fetchMock).toHaveBeenCalledWith('http://mro.local:3001/api/queue/status', expect.anything());
  expect(completions(fetchMock)).toEqual([
    ['/api/operator/missions/m1', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'complete', yardId: 'curiosity' }) })],
  ]);
  expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', name: 'Rock Lover' }));
});

it('leaves a run the rover could not execute for the operator', async () => {
  const fetchMock = fetchWith(roverHistory({ id: 'i1', status: 'error', params: { mission_id: 'm1' } }));
  global.fetch = fetchMock as unknown as typeof fetch;

  listen([queued('m1')]);
  await settle();

  expect(completions(fetchMock)).toHaveLength(0);
});

it('does not complete the same report again on the next poll', async () => {
  const fetchMock = fetchWith(roverHistory({ id: 'i1', status: 'completed', params: { mission_id: 'm1' } }));
  global.fetch = fetchMock as unknown as typeof fetch;

  // The queue still shows it open, as it would for the moment before the
  // subscription catches up with the write.
  listen([queued('m1')]);
  await settle();
  await act(async () => {
    jest.advanceTimersByTime(COMPLETION_POLL_MS);
  });
  await settle();

  expect(completions(fetchMock)).toHaveLength(1);
});

it('stops acting on a report the server says is already settled', async () => {
  const fetchMock = fetchWith(roverHistory({ id: 'i1', status: 'completed', params: { mission_id: 'm1' } }), 409);
  global.fetch = fetchMock as unknown as typeof fetch;

  const onCompleted = listen([queued('m1')]);
  await settle();
  await act(async () => {
    jest.advanceTimersByTime(COMPLETION_POLL_MS);
  });
  await settle();

  expect(completions(fetchMock)).toHaveLength(1);
  expect(onCompleted).not.toHaveBeenCalled();
});

it('never reaches for the yard where the browser would have to ask first', async () => {
  permission.state = 'prompt';
  const fetchMock = fetchWith(roverHistory({ id: 'i1', status: 'completed', params: { mission_id: 'm1' } }));
  global.fetch = fetchMock as unknown as typeof fetch;

  listen([queued('m1')]);
  await settle();
  await act(async () => {
    jest.advanceTimersByTime(COMPLETION_POLL_MS * 3);
  });
  await settle();

  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not poll from a background tab', async () => {
  hidden = true;
  const fetchMock = fetchWith(roverHistory({ id: 'i1', status: 'completed', params: { mission_id: 'm1' } }));
  global.fetch = fetchMock as unknown as typeof fetch;

  listen([queued('m1')]);
  await settle();
  await act(async () => {
    jest.advanceTimersByTime(COMPLETION_POLL_MS * 3);
  });
  await settle();

  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not ask the yard when nothing in the queue is open', async () => {
  const fetchMock = fetchWith(roverHistory());
  global.fetch = fetchMock as unknown as typeof fetch;

  listen([{ ...queued('m1'), status: 'completed' }]);
  await settle();

  expect(fetchMock).not.toHaveBeenCalled();
});
