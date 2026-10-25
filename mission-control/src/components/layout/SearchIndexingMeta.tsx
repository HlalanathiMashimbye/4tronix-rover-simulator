import { connection } from 'next/server';

import { isProduction } from '@/infrastructure/config/environment';

/**
 * Keeps every environment but prod out of search results.
 *
 * Staging answered on marsyard.labs.ws as the live site for months, so it may
 * already be indexed, and from go-live its feed is test data. A noindex tag is
 * what takes indexed pages out; robots.txt stays open on purpose, because a
 * crawler that is not allowed to fetch a page never sees the tag telling it to
 * drop the page.
 *
 * `await connection()` for the reason EnvironmentBanner gives: rendered at
 * build time this would be decided as staging, and prod would tell search
 * engines to forget it.
 */
export async function SearchIndexingMeta() {
  await connection();

  if (isProduction()) {
    return null;
  }

  return <meta name="robots" content="noindex, nofollow" />;
}
