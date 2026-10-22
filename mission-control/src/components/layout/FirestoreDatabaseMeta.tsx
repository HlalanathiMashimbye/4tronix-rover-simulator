import { connection } from 'next/server';

import {
  DATABASE_META_NAME,
  resolveFirestoreDatabaseId,
} from '@/infrastructure/config/firestoreDatabase';

/**
 * Tells the browser which Firestore database this deployment uses.
 *
 * The browser reads missions straight from Firestore, and the image it runs
 * was built for staging, so it cannot know the database by itself. The server
 * does, from FIREBASE_DATABASE_ID, and says so in the page.
 *
 * `await connection()` for the reason EnvironmentBanner gives: without it this
 * renders once at build time, as staging, and every prod page would point the
 * browser at staging's database.
 */
export async function FirestoreDatabaseMeta() {
  await connection();

  return <meta name={DATABASE_META_NAME} content={resolveFirestoreDatabaseId()} />;
}
