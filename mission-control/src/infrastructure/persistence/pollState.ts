import 'server-only';

import { getFirestoreInstance } from '@/infrastructure/persistence/firebase-admin';

/**
 * When the YouTube linker last actually ran.
 *
 * Cloud Scheduler fires on a fixed 5-minute cadence and the admin-set interval
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

export async function recordChecked(at: Date = new Date()): Promise<void> {
  await getFirestoreInstance()
    .collection(DOC_PATH[0])
    .doc(DOC_PATH[1])
    .set({ lastCheckedAt: at.toISOString() }, { merge: true });
}

/** Whether enough time has passed for another check to be due. */
export function isDue(last: Date | null, intervalMinutes: number, now: Date = new Date()): boolean {
  if (!last) return true;
  return now.getTime() - last.getTime() >= intervalMinutes * 60_000;
}
