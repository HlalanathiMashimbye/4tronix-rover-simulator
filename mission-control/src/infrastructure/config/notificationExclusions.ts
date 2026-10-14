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

/** Why every entry below is here: one test session, one problem. */
const TEST_MISSION_26_SEP =
  'Test mission sent on 26 Sep 2026 carrying an email hash; its notifications reached someone they were not meant for (AB#470).';

/**
 * The 26 September test missions that carry an email hash, as confirmed by
 * the team on 14 October 2026. No other mission sent that day is listed, and
 * none of them is affected.
 */
export const NOTIFICATION_EXCLUSIONS: readonly NotificationExclusion[] = [
  {
    // Mighty Rock Seeker
    missionId: 'dMxaVCCnpGmfaS_902t43',
    reason: TEST_MISSION_26_SEP,
    decidedOn: '2026-10-14',
  },
  {
    // Eager Helios Pioneer
    missionId: 'cIgRU5eNGqX8CZLUPYrqR',
    reason: TEST_MISSION_26_SEP,
    decidedOn: '2026-10-14',
  },
  {
    // Lucky Mars Prospector
    missionId: 'Ktlh4oLSZ2-11nxzsN6zG',
    reason: TEST_MISSION_26_SEP,
    decidedOn: '2026-10-14',
  },
  {
    // Steady Sand Wanderer
    missionId: 'B0q3sdAz7BhJZipS0AMmL',
    reason: TEST_MISSION_26_SEP,
    decidedOn: '2026-10-14',
  },
  {
    // Eager Crater Observer
    missionId: 'qoDwbhjejm6oz64ZlHVJI',
    reason: TEST_MISSION_26_SEP,
    decidedOn: '2026-10-14',
  },
  {
    // Proud Crater Mapper: same test session as the three above it
    missionId: 'Y5znqho-0RUiqSdn2f3dq',
    reason: TEST_MISSION_26_SEP,
    decidedOn: '2026-10-14',
  },
];

export const EXCLUDED_MISSION_IDS: ReadonlySet<string> = new Set(
  NOTIFICATION_EXCLUSIONS.map((exclusion) => exclusion.missionId),
);
