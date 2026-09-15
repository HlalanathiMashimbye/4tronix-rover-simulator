/**
 * Unit Tests for MissionNotificationService
 *
 * Tests notification logic in isolation: a mocked IEmailSender, a recording
 * composer, and a contact reader that returns whatever the test says. Where the
 * address is read from in Firestore is FirestoreLearnerContactReader's job, and
 * is tested there.
 */

import { MissionNotificationService } from '@/core/application/services/MissionNotificationService';
import { IEmailSender } from '@/core/domain/services/IEmailSender';
import {
  ILearnerContactReader,
  LearnerContact,
} from '@/core/domain/services/ILearnerContactReader';
import { Mission } from '@/core/domain/entities/Mission';

class MockEmailSender implements IEmailSender {
  public calls: Array<{ to: string; subject: string; html: string }> = [];
  private failNext = false;

  async send(to: string, subject: string, html: string): Promise<void> {
    if (this.failNext) {
      throw new Error('Resend is down');
    }
    this.calls.push({ to, subject, html });
  }

  failOnNextSend() {
    this.failNext = true;
  }
}

/** A reader that knows exactly one learner, and records who it was asked for. */
function contactsOf(contact: LearnerContact) {
  const findByLearnerRef = jest.fn(async (_learnerRef: string) => contact);
  const reader: ILearnerContactReader = { findByLearnerRef };
  return { reader, findByLearnerRef };
}

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    yardId: 'yard-1',
    learnerRef: 'learner-1',
    sessionId: 'session-1',
    name: 'Orbital Nomad',
    code: 'rover.forward(100)',
    status: 'queued',
    submittedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const APP_URL = 'http://localhost:3000';

/**
 * A composer that records what it was asked for rather than rendering HTML.
 * This is what the IMissionEmailComposer port buys: these tests are about
 * whether a notification is sent and to whom, and they no longer drag in a
 * few hundred lines of inline markup to find out.
 */
interface ComposerCall {
  status: string;
  missionName: string;
  learnerName?: string | null;
  missionUrl: string;
  historyUrl: string;
}
const composerCalls: ComposerCall[] = [];
const composer = {
  statusUpdate: (status: string, input: Omit<ComposerCall, 'status'>) => {
    composerCalls.push({ status, ...input });
    return { subject: `[${status}] ${input.missionName}`, html: `<p>${status}</p>` };
  },
} as never;

const ADA = { email: 'ada@school.edu', displayName: 'Ada' };

beforeEach(() => {
  composerCalls.length = 0;
});

describe('MissionNotificationService', () => {
  it('skips when the learner has no email', async () => {
    const sender = new MockEmailSender();
    const service = new MissionNotificationService(sender, composer, contactsOf({ displayName: 'Ada' }).reader, APP_URL);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(service.notifyStatusChange(makeMission(), 'processing')).resolves.toEqual({
      sent: false,
      reason: 'no-learner-email',
    });

    expect(sender.calls).toHaveLength(0);
    warn.mockRestore();
  });

  it('skips when there is no learner at all', async () => {
    const sender = new MockEmailSender();
    const service = new MissionNotificationService(sender, composer, contactsOf({}).reader, APP_URL);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(service.notifyStatusChange(makeMission(), 'processing')).resolves.toEqual({
      sent: false,
      reason: 'no-learner-email',
    });

    expect(sender.calls).toHaveLength(0);
    warn.mockRestore();
  });

  it("sends to the address of this mission's learner", async () => {
    const sender = new MockEmailSender();
    const contacts = contactsOf(ADA);
    const service = new MissionNotificationService(sender, composer, contacts.reader, APP_URL);

    await expect(service.notifyStatusChange(makeMission({ learnerRef: 'learner-7' }), 'completed'))
      .resolves.toEqual({ sent: true });

    expect(contacts.findByLearnerRef).toHaveBeenCalledWith('learner-7');
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].to).toBe('ada@school.edu');
    expect(composerCalls[0].missionName).toBe('Orbital Nomad');
    expect(composerCalls[0].historyUrl).toBe(`${APP_URL}/history`);
  });

  it('deep links the email to the mission that changed, not just the history list', async () => {
    // David asked for /missions/<id> so a learner opens the run the email is
    // about. The history link stays as the secondary way back in.
    const service = new MissionNotificationService(new MockEmailSender(), composer, contactsOf(ADA).reader, APP_URL);

    await service.notifyStatusChange(makeMission({ id: 'mission-42' }), 'completed');

    expect(composerCalls[0].missionUrl).toBe(`${APP_URL}/missions/mission-42`);
  });

  it('does not double up the slash when the app URL has a trailing one', async () => {
    // NEXT_PUBLIC_APP_URL is set by hand in a GitHub variable, so a trailing
    // slash is a realistic typo and '//missions/x' breaks some mail clients.
    const service = new MissionNotificationService(
      new MockEmailSender(), composer, contactsOf(ADA).reader, `${APP_URL}/`,
    );

    await service.notifyStatusChange(makeMission({ id: 'mission-42' }), 'completed');

    expect(composerCalls[0].missionUrl).toBe(`${APP_URL}/missions/mission-42`);
    expect(composerCalls[0].missionUrl).not.toContain('//missions');
  });

  it('greets by the display name that came with the address', async () => {
    // Regression: the address used to be read off the mission while the name
    // was looked up under a different id, so every email said "Space Explorer".
    const service = new MissionNotificationService(new MockEmailSender(), composer, contactsOf(ADA).reader, APP_URL);

    await service.notifyStatusChange(makeMission(), 'completed');

    expect(composerCalls[0].learnerName).toBe('Ada');
  });

  it('falls back to "Space Explorer" when the learner has an email but no name', async () => {
    const service = new MissionNotificationService(
      new MockEmailSender(), composer, contactsOf({ email: 'ada@school.edu' }).reader, APP_URL,
    );

    await service.notifyStatusChange(makeMission(), 'completed');

    expect(composerCalls[0].learnerName).toBeFalsy();
  });

  it('falls back to the mission id when the mission has no name', async () => {
    const service = new MissionNotificationService(new MockEmailSender(), composer, contactsOf(ADA).reader, APP_URL);

    await service.notifyStatusChange(makeMission({ name: undefined, id: 'mission-xyz' }), 'completed');

    expect(composerCalls[0].missionName).toBe('mission-xyz');
  });

  it('never puts a plaintext address on the mission it reads', async () => {
    const service = new MissionNotificationService(new MockEmailSender(), composer, contactsOf(ADA).reader, APP_URL);
    const mission = makeMission();

    await service.notifyStatusChange(mission, 'completed');

    expect(Object.keys(mission)).not.toContain('learnerEmail');
  });

  it('reports sender errors instead of throwing', async () => {
    const sender = new MockEmailSender();
    sender.failOnNextSend();
    const service = new MissionNotificationService(sender, composer, contactsOf(ADA).reader, APP_URL);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.notifyStatusChange(makeMission(), 'failed')).resolves.toEqual({
      sent: false,
      reason: 'send-failed',
      error: expect.any(String),
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('reports a failure when the learner lookup itself throws', async () => {
    const sender = new MockEmailSender();
    const failing: ILearnerContactReader = {
      findByLearnerRef: async () => {
        throw new Error('Firestore unavailable');
      },
    };
    const service = new MissionNotificationService(sender, composer, failing, APP_URL);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(service.notifyStatusChange(makeMission(), 'queued')).resolves.toEqual({
      sent: false,
      reason: 'send-failed',
      error: 'Firestore unavailable',
    });

    expect(sender.calls).toHaveLength(0);
    consoleErrorSpy.mockRestore();
  });
});
