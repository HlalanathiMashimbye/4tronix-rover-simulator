import 'server-only';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';
import { isDue, SCHEDULER_CADENCE_MINUTES } from '@/core/domain/services/youtubeLinkSchedule';

/**
 * When the YouTube linker last actually ran.
 *
 * Cloud Scheduler fires on a fixed 15-minute cadence and the admin-set interval
 * decides how often that does any work. The alternative was letting the
 * settings page rewrite the Cloud Scheduler job itself, which means the app
 * editing infrastructure Terraform owns, and the two then fight over it on
 * every apply.
 *
 * One document, not a collection: this is a single timestamp, and putting it
 * in `appState` keeps it out of `missions` where a stray document would show
 * up in the learner feed's queries.
 */
const DOC_PATH = ['appState', 'youtubeLink'] as const;

export async function lastCheckedAt(): Promise<Date | null> {
  const snapshot = await getFirestoreInstance()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .get();

  const value = snapshot.data()?.lastCheckedAt;
  return typeof value === 'string' ? new Date(value) : null;
}

/**
 * The interval rides along in the same document as the timestamp, in the same
 * write. The operator's status line needs both to say when the next check is,
 * and reading the interval there instead of from Secret Manager costs nothing
 * extra on either side.
 */
export async function recordChecked(at: Date = new Date(), intervalMinutes?: number): Promise<void> {
  await getFirestoreInstance()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .set(
      { lastCheckedAt: at.toISOString(), ...(intervalMinutes ? { intervalMinutes } : {}) },
      { merge: true },
    );
}

/** The last check and the interval it ran under, in one read. */
export async function readLinkerState(): Promise<{ lastCheckedAt: Date | null; intervalMinutes: number }> {
  const snapshot = await getFirestoreInstance()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .get();

  const data = snapshot.data() ?? {};
  return {
    lastCheckedAt: typeof data.lastCheckedAt === 'string' ? new Date(data.lastCheckedAt) : null,
    intervalMinutes: typeof data.intervalMinutes === 'number' ? data.intervalMinutes : SCHEDULER_CADENCE_MINUTES,
  };
}

// The rule lives in the domain now, beside what the operator's status line
// reads; re-exported so the linker keeps importing its throttle from here.
export { isDue };
