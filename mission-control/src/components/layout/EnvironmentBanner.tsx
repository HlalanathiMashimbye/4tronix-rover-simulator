import { connection } from 'next/server';

import { resolveEnvironment } from '@/infrastructure/config/environment';

/**
 * A strip across the top of every non-production page.
 *
 * Server component, so the environment is read at request time and never baked
 * into the bundle. Renders nothing at all in production rather than rendering
 * a hidden element, so there is no prod markup to leak or mis-style.
 *
 * `await connection()` is load-bearing, not ceremony. Without it this sits in a
 * statically prerendered layout, so resolveEnvironment() runs at BUILD time -
 * when APP_ENV does not exist yet - and the answer is baked into the HTML. The
 * live staging site said "LOCAL DEVELOPMENT" for exactly that reason: moving
 * the value to a runtime variable achieves nothing while the RENDER is still
 * build-time. connection() opts this into dynamic rendering so the variable is
 * read per request. See next/docs 01-app/02-guides/environment-variables.md.
 */
export async function EnvironmentBanner() {
  await connection();

  const environment = resolveEnvironment();

  if (environment === 'prod') {
    return null;
  }

  const label =
    environment === 'staging'
      ? 'STAGING — not the live site. Missions submitted here are test data.'
      : 'LOCAL DEVELOPMENT';

  return (
    <div
      role="status"
      style={{
        background: '#b45309',
        color: '#fff',
        font: '600 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        letterSpacing: '0.04em',
        textAlign: 'center',
        padding: '6px 12px',
      }}
    >
      {label}
    </div>
  );
}
