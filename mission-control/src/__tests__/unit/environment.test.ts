/**
 * Unit tests for the environment resolver.
 *
 * The case that matters: prod runs the image built during the STAGING deploy,
 * so this must be a runtime read. If it ever became NEXT_PUBLIC_, production
 * would permanently badge itself as staging.
 */

import { resolveEnvironment, isProduction } from '@/infrastructure/config/environment';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('resolveEnvironment', () => {
  it.each([
    ['prod', 'prod'],
    ['production', 'prod'],
    ['staging', 'staging'],
  ])('maps APP_ENV=%s to %s', (raw, expected) => {
    process.env.APP_ENV = raw;
    expect(resolveEnvironment()).toBe(expected);
  });

  it('is case and whitespace insensitive, because this is set by hand in Terraform', () => {
    process.env.APP_ENV = '  Staging ';
    expect(resolveEnvironment()).toBe('staging');
  });

  it('falls back to development when APP_ENV is unset', () => {
    delete process.env.APP_ENV;
    expect(resolveEnvironment()).toBe('development');
  });

  it('treats an unrecognised value as non-production rather than guessing', () => {
    // Safe direction: a mislabelled prod is embarrassing, an unlabelled staging
    // is how someone dispatches a rover from the wrong environment.
    process.env.APP_ENV = 'preprod';
    expect(resolveEnvironment()).toBe('development');
    expect(isProduction()).toBe(false);
  });

  it('reports production only for an explicit prod value', () => {
    process.env.APP_ENV = 'prod';
    expect(isProduction()).toBe(true);
  });
});
