/**
 * Mission Email Composer Interface
 *
 * Domain layer defines the contract; infrastructure layer provides the
 * concrete implementation (the HTML templates). Sibling of IEmailSender:
 * that one is how an email is delivered, this one is what it says.
 *
 * MissionNotificationService used to import buildMissionStatusEmail from
 * infrastructure directly, which is the layering rule backwards and had a
 * practical cost too: the service could not be tested without dragging in a
 * few hundred lines of inline HTML, so its tests asserted on markup they did
 * not care about.
 */

import { MissionStatus } from '@/core/domain/entities/Mission';

export interface MissionEmailInput {
  missionName: string;
  learnerName?: string | null;
  /**
   * Deep link to this one mission. The primary CTA - a learner who opens the
   * email wants the run they were told about, not a list to search.
   */
  missionUrl: string;
  historyUrl: string;
}

export interface MissionEmailContent {
  subject: string;
  html: string;
}

export interface IMissionEmailComposer {
  statusUpdate(status: MissionStatus, input: MissionEmailInput): MissionEmailContent;
}
