/**
 * Mission Notification Service
 *
 * Sends a status-change email to the learner when their mission's status
 * updates. Best-effort: an email-provider failure or missing learner email
 * must never fail the mission write it's reacting to, so every failure is
 * caught and logged rather than propagated.
 *
 * Every collaborator is a port - how mail is delivered, what it says, and whom
 * it is for - so this class holds the rules about notifying and nothing about
 * Resend or Firestore. It is assembled once, by notificationService() in
 * container.server.ts; three routes used to build it by hand.
 */

import { Mission, MissionStatus } from '@/core/domain/entities/Mission';
import { IEmailSender } from '@/core/domain/services/IEmailSender';
import { IMissionEmailComposer } from '@/core/domain/services/IMissionEmailComposer';
import { missionSlug } from '@/core/domain/services/missionSlug';
import { hashLearnerEmail } from '@/core/domain/services/learnerEmailHash';
import {
  ILearnerContactReader,
  LearnerContact,
} from '@/core/domain/services/ILearnerContactReader';

/** Log prefix so every notification attempt is greppable in server output. */
const LOG_TAG = '[mission-email]';

/**
 * Why a send did or did not happen. Returned rather than thrown so callers keep
 * their best-effort semantics, but the outcome is no longer invisible: a silent
 * catch is how the whole feature sat broken without anyone noticing.
 */
export type NotifyOutcome =
  | { sent: true }
  | {
      sent: false;
      reason: 'no-learner-email' | 'send-failed' | 'excluded' | 'address-mismatch';
      error?: string;
    };

export class MissionNotificationService {
  constructor(
    private readonly emailSender: IEmailSender,
    /** What the email says. Injected for the same reason emailSender is. */
    private readonly emailComposer: IMissionEmailComposer,
    /** Where the learner's address and name come from. */
    private readonly contacts: ILearnerContactReader,
    /**
     * Base URL of the learner app, e.g. https://marsyard.sapient.rocks. The
     * per-mission and history links are derived here rather than passed in, so
     * every route that sends mail cannot drift on how they are built.
     */
    private readonly appUrl: string,
    /**
     * Missions that must never send mail, whatever their status (AB#470): the
     * reviewed list in infrastructure/config/notificationExclusions.ts.
     */
    private readonly excludedMissionIds: ReadonlySet<string> = new Set(),
  ) {}

  async notifyStatusChange(mission: Mission, status: MissionStatus): Promise<NotifyOutcome> {
    // Before anyone's address is even read: an excluded mission has nobody it
    // should reach.
    if (this.excludedMissionIds.has(mission.id)) {
      console.warn(`${LOG_TAG} skipped mission=${mission.id} status=${status} reason=excluded`);
      return { sent: false, reason: 'excluded' };
    }

    let learner: LearnerContact;

    try {
      learner = await this.contacts.findByLearnerRef(mission.learnerRef);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `${LOG_TAG} FAILED mission=${mission.id} status=${status}: could not read learner ${mission.learnerRef}: ${message}`
      );
      return { sent: false, reason: 'send-failed', error: message };
    }

    // The address is deliberately NOT on the mission document - mission docs are
    // world-readable - so no learner record means no way to reach them.
    if (!learner.email) {
      console.warn(
        `${LOG_TAG} skipped mission=${mission.id} status=${status} reason=no-learner-email learner=${mission.learnerRef}`
      );
      return { sent: false, reason: 'no-learner-email' };
    }

    /**
     * THE LEARNER HOLDS THE KEY, THE MISSION HOLDS THE HASH (AB#470).
     *
     * A mission carries learnerEmailHash only when its learner gave an address
     * as they sent it - that is them asking to hear about it. The address
     * itself is on the learner's private record. So the address we are about
     * to write to must hash to what the mission carries: if it does not, the
     * mail would reach someone the mission was never meant for (a test mission
     * sent with one address on another learner's record was exactly this), and
     * it is not sent.
     *
     * A mission with NO hash is left as it was - sent to the learner's address
     * - by decision: AB#470 requires that no other mission's notifications
     * change, and those missions predate a learner giving an address. See
     * docs/architecture/design-decisions.md, "Who a notification reaches".
     */
    if (mission.learnerEmailHash && (await hashLearnerEmail(learner.email)) !== mission.learnerEmailHash) {
      // The address is not logged here: it is not the one this mission asked for.
      console.warn(
        `${LOG_TAG} skipped mission=${mission.id} status=${status} reason=address-mismatch learner=${mission.learnerRef}`
      );
      return { sent: false, reason: 'address-mismatch' };
    }

    try {
      const { subject, html } = this.emailComposer.statusUpdate(status, {
        missionName: mission.name || mission.id,
        learnerName: learner.displayName,
        missionUrl: this.missionUrl(missionSlug(mission)),
        historyUrl: `${this.baseUrl()}/history`,
      });

      await this.emailSender.send(learner.email, subject, html);

      console.info(`${LOG_TAG} sent mission=${mission.id} status=${status} to=${learner.email}`);
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `${LOG_TAG} FAILED mission=${mission.id} status=${status} to=${learner.email}: ${message}`
      );
      return { sent: false, reason: 'send-failed', error: message };
    }
  }

  /** Trailing slashes on NEXT_PUBLIC_APP_URL are easy to leave in and would
   * otherwise produce '//missions/<id>', which some mail clients mangle. */
  private baseUrl(): string {
    return this.appUrl.replace(/\/+$/, '');
  }

  /** Deep link to one mission - matches the app/missions/[missionId] route. */
  private missionUrl(missionId: string): string {
    return `${this.baseUrl()}/missions/${encodeURIComponent(missionId)}`;
  }
}
