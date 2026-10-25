/**
 * The reviewed list of missions that must never notify (AB#470).
 *
 * Each entry stops a learner's mail, so each must say why and when it was
 * agreed - a bare id is an exclusion nobody can later justify or remove.
 */

import { EXCLUDED_MISSION_IDS, NOTIFICATION_EXCLUSIONS } from '@/infrastructure/config/notificationExclusions';

it('gives every exclusion a reason and the date it was agreed', () => {
  for (const exclusion of NOTIFICATION_EXCLUSIONS) {
    expect(exclusion.missionId.trim()).not.toBe('');
    expect(exclusion.reason.trim().length).toBeGreaterThan(10);
    expect(exclusion.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});

it('lists each mission once, and the set the service reads holds exactly them', () => {
  const ids = NOTIFICATION_EXCLUSIONS.map((e) => e.missionId);
  expect(new Set(ids).size).toBe(ids.length);
  expect([...EXCLUDED_MISSION_IDS].sort()).toEqual([...ids].sort());
});

it('is handed to the one notification service the app builds', async () => {
  // Dropping the argument would still compile - the service defaults to
  // excluding nothing - so this builds the container's real service, with
  // only the outside world stubbed, and checks it refuses a listed mission.
  jest.resetModules();
  jest.doMock('@/infrastructure/email/resend-client', () => ({ ResendEmailSender: jest.fn(() => ({ send: jest.fn() })) }));
  jest.doMock('@/infrastructure/persistence/firebase-admin', () => ({ getFirestoreInstance: () => ({}) }));
  const { notificationService } = await import('@/infrastructure/container.server');
  const [{ missionId }] = NOTIFICATION_EXCLUSIONS;
  const mission = { id: missionId, learnerRef: 'r', name: 'm', code: '', status: 'queued', submittedAt: '' } as never;
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  await expect(notificationService().notifyStatusChange(mission, 'completed')).resolves.toEqual({ sent: false, reason: 'excluded' });
  warn.mockRestore();
});

it('stops every listed mission, through the service the app builds with the list', async () => {
  // The listed ids are the 26 Sep test missions (AB#470): each must reach no one.
  const { MissionNotificationService } = await import('@/core/application/services/MissionNotificationService');
  const send = jest.fn();
  const findByLearnerRef = jest.fn(async () => ({ email: 'someone@example.com' }));
  const service = new MissionNotificationService(
    { send },
    { statusUpdate: () => ({ subject: '', html: '' }) },
    { findByLearnerRef },
    'http://localhost:3000',
    EXCLUDED_MISSION_IDS,
  );
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  expect(NOTIFICATION_EXCLUSIONS.length).toBeGreaterThan(0);
  for (const { missionId } of NOTIFICATION_EXCLUSIONS) {
    const mission = { id: missionId, learnerRef: 'r', name: 'm', code: '', status: 'queued', submittedAt: '' } as never;
    await expect(service.notifyStatusChange(mission, 'completed')).resolves.toEqual({ sent: false, reason: 'excluded' });
  }
  expect(send).not.toHaveBeenCalled();
  expect(findByLearnerRef).not.toHaveBeenCalled();
  warn.mockRestore();
});
