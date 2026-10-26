/**
 * @jest-environment jsdom
 */

/**
 * The learner context: who this browser is, and where their email goes.
 *
 * Untested while it talked to Firestore directly. Behind ILearnerRepository it
 * runs against an in-memory record, which is what this does.
 */

import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import type { Learner } from '@/core/domain/entities/Learner';
import { LearnerProvider, useLearner } from '@/contexts/LearnerContext';

const records = new Map<string, Learner & { learnerRef?: string }>();
const visits: string[] = [];
const stamps = new Map<string, string>();
let failReads = false;

jest.mock('@/infrastructure/container.browser', () => ({
  browserLearnerRepository: () => ({
    findById: async (id: string) => {
      if (failReads) throw new Error('offline');
      return records.get(id) ?? null;
    },
    create: async (learner: Learner, learnerRef: string) => {
      records.set(learner.id, { ...learner, learnerRef });
    },
    recordVisit: async (id: string, learnerRef: string, at: string, displayName?: string) => {
      visits.push(id);
      records.set(id, { ...records.get(id)!, learnerRef, lastActiveAt: at, ...(displayName ? { displayName } : {}) });
    },
  }),
  browserLearnerEmailStamp: () => ({
    stampLearnerEmailHash: async (missionId: string, hash: string) => {
      if (stamps.has(missionId)) return false;
      stamps.set(missionId, hash);
      return true;
    },
  }),
}));

// Handed out through an effect, not assigned during render, so the probe
// stays a pure component.
let context: ReturnType<typeof useLearner>;
function Probe() {
  const learner = useLearner();
  useEffect(() => {
    context = learner;
  });
  return <p>{learner.loading ? 'loading' : learner.learner?.id}</p>;
}

const notifyCalls = () =>
  (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/notify'));

beforeAll(() => {
  // jsdom has neither SubtleCrypto nor TextEncoder, and learner ids are hashed
  // with both before they touch any record.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
});

beforeEach(() => {
  records.clear();
  visits.length = 0;
  stamps.clear();
  failReads = false;
  localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
});

it('creates a record for a browser seen for the first time, storing the hash of its id', async () => {
  render(<LearnerProvider><Probe /></LearnerProvider>);

  await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
  const id = context.learner!.id;
  expect(records.get(id)?.learnerRef).toMatch(/^[0-9a-f]{64}$/);
  expect(records.get(id)?.learnerRef).not.toBe(id);
  expect(visits).toEqual([]);
});

it('recognises a returning learner and records the visit instead of creating them again', async () => {
  localStorage.setItem('mars-rover-learner-id', 'returning-learner');
  records.set('returning-learner', {
    id: 'returning-learner', sessionId: 'returning-learner', createdAt: '2026-01-01T00:00:00Z', lastActiveAt: '2026-01-01T00:00:00Z',
  });

  render(<LearnerProvider><Probe /></LearnerProvider>);

  await waitFor(() => expect(screen.getByText('returning-learner')).toBeTruthy());
  expect(visits).toEqual(['returning-learner']);
  expect(records.get('returning-learner')?.createdAt).toBe('2026-01-01T00:00:00Z');
});

it('gives a new learner a name, and one recorded without a name gets one on its visit', async () => {
  render(<LearnerProvider><Probe /></LearnerProvider>);
  await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
  expect(records.get(context.learner!.id)?.displayName).toBeTruthy();

  localStorage.setItem('mars-rover-learner-id', 'unnamed-learner');
  records.set('unnamed-learner', {
    id: 'unnamed-learner', sessionId: 'unnamed-learner', createdAt: '2026-01-01T00:00:00Z', lastActiveAt: '2026-01-01T00:00:00Z',
  });
  render(<LearnerProvider><Probe /></LearnerProvider>);
  await waitFor(() => expect(visits).toContain('unnamed-learner'));

  expect(records.get('unnamed-learner')?.displayName).toBeTruthy();
});

it('still gives the learner an identity when the record cannot be reached', async () => {
  failReads = true;

  render(<LearnerProvider><Probe /></LearnerProvider>);

  await waitFor(() => expect(screen.queryByText('loading')).toBeNull());
  expect(context.learner?.id).toBeTruthy();
});

it("stamps a new address onto the mission just sent, and sends its queued email once", async () => {
  localStorage.setItem('rover-latest-mission-id', 'mission-1');
  render(<LearnerProvider><Probe /></LearnerProvider>);
  await waitFor(() => expect(screen.queryByText('loading')).toBeNull());

  await act(() => context.setLearnerEmail('kid@example.com'));
  expect(stamps.get('mission-1')).toMatch(/^[0-9a-f]{64}$/);
  expect(notifyCalls()).toHaveLength(1);

  // Saving the same address again finds the mission already stamped.
  await act(() => context.setLearnerEmail('kid@example.com'));
  expect(notifyCalls()).toHaveLength(1);
});
