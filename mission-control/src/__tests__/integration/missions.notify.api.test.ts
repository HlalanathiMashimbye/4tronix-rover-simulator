/**
 * POST /api/missions/[id]/notify, narrowed to the one email it exists to send.
 *
 * Its only caller (LearnerContext.backfillLatestMissionEmail) sends the queued
 * email once, for a mission still in the queue. These tests pin that narrowing:
 * only `queued`, only while the mission is queued, only once, and the send
 * stays best-effort. The route is driven with the container mocked, so each
 * test controls the mission's state and the send's outcome directly; the
 * notification service and the transaction that records the send have their
 * own tests.
 */

const getMissionById = jest.fn();
const recordQueuedNotification = jest.fn();
const notifyStatusChange = jest.fn();

jest.mock('@/infrastructure/container.server', () => ({
  missionService: () => ({ getMissionById }),
  queuedNotificationRecorder: () => ({ recordQueuedNotification }),
  notificationService: () => ({ notifyStatusChange }),
}));

import { POST } from '@/app/api/missions/[id]/notify/route';
import { NextRequest } from 'next/server';

const QUEUED_MISSION = { id: 'mission-1', status: 'queued', name: 'Orbital Nomad' };

function notifyRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/missions/${id}/notify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function call(id: string, body: unknown) {
  return POST(notifyRequest(id, body), { params: Promise.resolve({ id }) });
}

describe('POST /api/missions/[id]/notify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMissionById.mockResolvedValue(QUEUED_MISSION);
    recordQueuedNotification.mockResolvedValue('recorded');
    notifyStatusChange.mockResolvedValue({ sent: true });
  });

  it('sends the queued email for a queued mission, once', async () => {
    const response = await call('mission-1', { status: 'queued' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, notification: { sent: true } });
    expect(notifyStatusChange).toHaveBeenCalledWith(QUEUED_MISSION, 'queued');
  });

  it('reports the send outcome in the body rather than hiding a skip', async () => {
    notifyStatusChange.mockResolvedValue({ sent: false, reason: 'no-learner-email' });

    const response = await call('mission-1', { status: 'queued' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      notification: { sent: false, reason: 'no-learner-email' },
    });
  });

  it('still returns 200 when the send itself fails', async () => {
    notifyStatusChange.mockResolvedValue({ sent: false, reason: 'send-failed', error: 'Resend is down' });

    const response = await call('mission-1', { status: 'queued' });

    expect(response.status).toBe(200);
    expect((await response.json()).notification).toEqual({
      sent: false,
      reason: 'send-failed',
      error: 'Resend is down',
    });
  });

  it('refuses a second queued call and sends nothing', async () => {
    recordQueuedNotification.mockResolvedValue('already');

    const response = await call('mission-1', { status: 'queued' });

    expect(response.status).toBe(409);
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });

  it('refuses a status that is not queued', async () => {
    const response = await call('mission-1', { status: 'completed' });

    expect(response.status).toBe(403);
    expect(getMissionById).not.toHaveBeenCalled();
    expect(recordQueuedNotification).not.toHaveBeenCalled();
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });

  it('refuses a mission that has left the queue', async () => {
    getMissionById.mockResolvedValue({ ...QUEUED_MISSION, status: 'processing' });

    const response = await call('mission-1', { status: 'queued' });

    expect(response.status).toBe(409);
    expect(recordQueuedNotification).not.toHaveBeenCalled();
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });

  it('refuses when the mission leaves the queue during the request', async () => {
    // The pre-check saw it queued; the transaction found otherwise.
    recordQueuedNotification.mockResolvedValue('not-queued');

    const response = await call('mission-1', { status: 'queued' });

    expect(response.status).toBe(409);
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown mission id', async () => {
    getMissionById.mockResolvedValue(null);

    const response = await call('does-not-exist', { status: 'queued' });

    expect(response.status).toBe(404);
    expect(recordQueuedNotification).not.toHaveBeenCalled();
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });

  it('rejects an invalid status value with 400', async () => {
    const response = await call('mission-1', { status: 'launched' });

    expect(response.status).toBe(400);
    expect(notifyStatusChange).not.toHaveBeenCalled();
  });
});
