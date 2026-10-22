/**
 * Missions that must never send a notification email (AB#470).
 *
 * THE RECORDED DECISION for test data that carries an email hash: it is
 * IGNORED BY ID, here - not deleted and not nulled in Firestore, and not
 * caught by a date cutoff.
 *
 * - Deleting loses the mission from the feed and history, and cannot be undone.
 * - Nulling learnerEmailHash would not stop the mail: a mission with no hash
 *   still notifies its learner (MissionNotificationService), by the decision
 *   that no other mission's notifications change.
 * - A date cutoff would silence every real mission before that date too.
 *
 * Listing the id stops this one mission, changes nothing else, needs no write
 * to production data, and is undone by deleting a line. Treat this list as
 * reviewed: each entry stops a learner's mail, so each says why and who
 * decided. docs/architecture/design-decisions.md records the reasoning.
 */

export interface NotificationExclusion {
  missionId: string;
  reason: string;
  /** ISO date the exclusion was agreed. */
  decidedOn: string;
}

export const NOTIFICATION_EXCLUSIONS: readonly NotificationExclusion[] = [];

export const EXCLUDED_MISSION_IDS: ReadonlySet<string> = new Set(
  NOTIFICATION_EXCLUSIONS.map((exclusion) => exclusion.missionId),
);
