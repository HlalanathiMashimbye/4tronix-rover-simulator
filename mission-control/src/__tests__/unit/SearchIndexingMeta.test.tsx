/**
 * Only prod may be indexed, decided at runtime.
 *
 * From go-live, staging's feed is test data, and it answered as the live site
 * for months, so it may already be in search results. Prod runs the image
 * built for staging, so a build-time answer would tell search engines to drop
 * prod instead.
 */

import type { ReactElement } from 'react';
import { SearchIndexingMeta } from '@/components/layout/SearchIndexingMeta';

const connectionMock = jest.fn(async () => {});
jest.mock('next/server', () => ({ connection: () => connectionMock() }));

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  connectionMock.mockClear();
});

function robotsOf(element: ReactElement | null): string | null {
  if (!element) return null;
  const props = element.props as { name?: string; content?: string };
  return props.name === 'robots' ? props.content ?? null : null;
}

describe('SearchIndexingMeta', () => {
  it('tells search engines to drop staging', async () => {
    process.env.APP_ENV = 'staging';

    expect(robotsOf(await SearchIndexingMeta())).toMatch(/noindex/);
  });

  it('says nothing on prod, so prod is indexed', async () => {
    process.env.APP_ENV = 'prod';

    expect(await SearchIndexingMeta()).toBeNull();
  });

  it('keeps local development out too', async () => {
    delete process.env.APP_ENV;

    expect(robotsOf(await SearchIndexingMeta())).toMatch(/noindex/);
  });

  it('decides per request, not at build time', async () => {
    process.env.APP_ENV = 'prod';
    await SearchIndexingMeta();

    expect(connectionMock).toHaveBeenCalled();
  });
});
