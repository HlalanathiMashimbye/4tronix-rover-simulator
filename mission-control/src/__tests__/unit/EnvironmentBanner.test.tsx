/**
 * The banner has to be right at RUNTIME, not at build time.
 *
 * Prod promotes the exact image built during the staging deploy, so anything
 * decided while `next build` runs is decided as staging. Not hypothetical: the
 * live staging site displayed "LOCAL DEVELOPMENT" because the banner sat in a
 * statically prerendered layout and was evaluated at build time, when APP_ENV
 * did not exist yet.
 *
 * Asserts on the returned element rather than rendering it: this suite runs in
 * a node environment with no DOM, and the behaviour under test is what the
 * component decides, not how it paints.
 */

import type { ReactElement } from 'react';
import { EnvironmentBanner } from '@/components/layout/EnvironmentBanner';

const connectionMock = jest.fn(async () => {});
jest.mock('next/server', () => ({ connection: () => connectionMock() }));

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  connectionMock.mockClear();
});

function labelOf(element: ReactElement | null): string | null {
  if (!element) return null;
  return (element.props as { children?: string }).children ?? null;
}

describe('EnvironmentBanner', () => {
  it('names the environment on staging', async () => {
    process.env.APP_ENV = 'staging';

    expect(labelOf(await EnvironmentBanner())).toMatch(/^STAGING/);
  });

  it('renders nothing at all in production', async () => {
    // Not a hidden element: there should be no prod markup to leak or mis-style.
    process.env.APP_ENV = 'prod';

    expect(await EnvironmentBanner()).toBeNull();
  });

  it('falls back to a non-production label when APP_ENV is unset', async () => {
    delete process.env.APP_ENV;

    expect(labelOf(await EnvironmentBanner())).toMatch(/LOCAL DEVELOPMENT/);
  });

  it('opts into dynamic rendering', async () => {
    // The load-bearing assertion. Without connection() this component is
    // prerendered into the layout and APP_ENV is read at build time, which is
    // exactly how staging ended up labelled as local development.
    process.env.APP_ENV = 'staging';
    await EnvironmentBanner();

    expect(connectionMock).toHaveBeenCalled();
  });
});
