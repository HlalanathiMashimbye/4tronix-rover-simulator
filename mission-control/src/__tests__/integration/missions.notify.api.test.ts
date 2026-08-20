/**
 * Integration Tests for POST /api/missions/[id]/notify
 *
 * This route is called by the yard operator console after it updates a
 * mission's status directly in Firestore - it only sends the email, it never
 * writes persistence itself. Uses mocked Firestore (missions + learners
 * collections) and a mocked Resend sender to avoid requiring real
 * credentials or network access.
 */

import { POST } from '@/app/api/missions/[id]/notify/route';
import { NextRequest } from 'next/server';

const sendMock = jest.fn(async (_to: string, _subject: string, _html: string) => {});

jest.mock('@/infrastructure/email/resend-client', () => ({
  ResendEmailSender: jest.fn().mockImplementation(() => ({ send: sendMock })),
}));

jest.mock('@/infrastructure/persistence/firebase-admin', () => ({
  getFirestoreInstance: jest.fn(() => mockFirestore),
}));

type DocData = Record<string, unknown>;

const missions = new Map<string, DocData>();
const learners = new Map<string, DocData>();

function makeQueryChain(store?: Map<string, DocData>) {
  // The notification service finds a learner by querying on learnerRef rather
  // than fetching by document id, so this chain has to actually filter the
  // store instead of always resolving empty.
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, jest.Mock> = {};
  chain.where = jest.fn((field: string, _op: string, value: unknown) => {
    filters.push([field, value]);
    return chain;
  });
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.count = jest.fn(() => ({
    get: jest.fn(async () => ({ data: () => ({ count: 0 }) })),
  }));
  chain.get = jest.fn(async () => {
    if (!store) return { empty: true, docs: [] };
    const docs = [...store.entries()]
      .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
      .map(([id, data]) => ({
        id,
        data: () => data,
        // The private contact subcollection is not modelled here; these tests
        // exercise the legacy learnerEmail fallback on the parent document.
        ref: {
          collection: jest.fn(() => ({
            doc: jest.fn(() => ({
              get: jest.fn(async () => ({ exists: false, data: () => undefined })),
            })),
          })),
        },
      }));
    return { empty: docs.length === 0, docs };
  });
  return chain;
}

function makeCollection(store: Map<string, DocData>) {
  const chain = makeQueryChain(store);

  return {
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => {
        const data = store.get(id);
        return { exists: !!data, data: () => data, id };
      }),
      update: jest.fn(async (updates: DocData) => {
        const existing = store.get(id) ?? {};
        store.set(id, { ...existing, ...updates });
      }),
    })),
    where: chain.where,
    orderBy: chain.orderBy,
  };
}

const mockFirestore = {
  collection: jest.fn((name: string) => (name === 'learners' ? makeCollection(learners) : makeCollection(missions))),
};

function notifyRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/missions/${id}/notify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/missions/[id]/notify Integration Tests', () => {
  beforeEach(() => {
    missions.clear();
    learners.clear();
    jest.clearAllMocks();

    missions.set('mission-1', {
      yardId: 'yard-1',
      learnerRef: 'learner-1',
      sessionId: 'session-1',
      name: 'Orbital Nomad',
      code: 'rover.forward(100)',
      status: 'processing',
      submittedAt: '2026-01-01T00:00:00.000Z',
    });
    learners.set('learner-1', { learnerRef: 'learner-1', learnerEmail: 'ada@school.edu', displayName: 'Ada' });
  });

  it('sends the status email without writing to the mission document', async () => {
    const response = await POST(notifyRequest('mission-1', { status: 'completed' }), {
      params: Promise.resolve({ id: 'mission-1' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [to, subject] = sendMock.mock.calls[0];
    expect(to).toBe('ada@school.edu');
    expect(subject).toContain('Orbital Nomad');

    // The route only notifies - it must not mutate the mission's own status.
    expect(missions.get('mission-1')?.status).toBe('processing');
  });

  it('reports a successful send in the response body', async () => {
    const response = await POST(notifyRequest('mission-1', { status: 'completed' }), {
      params: Promise.resolve({ id: 'mission-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, notification: { sent: true } });
  });

  it('returns 404 for an unknown mission id', async () => {
    const response = await POST(notifyRequest('does-not-exist', { status: 'completed' }), {
      params: Promise.resolve({ id: 'does-not-exist' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid status value with 400', async () => {
    const response = await POST(notifyRequest('mission-1', { status: 'launched' }), {
      params: Promise.resolve({ id: 'mission-1' }),
    });

    expect(response.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not send an email when the learner record has no address', async () => {
    missions.set('mission-1', {
      yardId: 'yard-1',
      learnerRef: 'learner-1',
      sessionId: 'session-1',
      name: 'Orbital Nomad',
      code: 'rover.forward(100)',
      status: 'processing',
      submittedAt: '2026-01-01T00:00:00.000Z',
    });

    // Reachability now depends entirely on the learner record: the mission
    // carries only a hash, so an address-less learner means no email.
    learners.set('learner-1', { displayName: 'Ada' });

    const response = await POST(notifyRequest('mission-1', { status: 'completed' }), {
      params: Promise.resolve({ id: 'mission-1' }),
    });

    expect(response.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
    // Reported, not silent: the caller has to be able to tell this apart from
    // a successful send, or a misconfiguration looks identical to working.
    expect(await response.json()).toEqual({
      success: true,
      notification: { sent: false, reason: 'no-learner-email' },
    });
  });

  it('still returns 200 when the email send fails', async () => {
    sendMock.mockRejectedValueOnce(new Error('Resend is down'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(notifyRequest('mission-1', { status: 'completed' }), {
      params: Promise.resolve({ id: 'mission-1' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    // Best-effort stays best-effort - the yard console must not be failed by a
    // provider outage - but the reason travels back with the 200.
    expect(data.notification).toEqual({
      sent: false,
      reason: 'send-failed',
      error: 'Resend is down',
    });
    consoleErrorSpy.mockRestore();
  });
});
