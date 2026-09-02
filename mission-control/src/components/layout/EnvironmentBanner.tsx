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
 * statically prerendered layout, so resolveEnvironment() runs at BUILD time,
 * when APP_ENV does not exist yet, and the answer is baked into the HTML. The
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

  /**
   * A colour per environment, and they are deliberately far apart on the wheel
   * rather than two shades of one warning colour.
   *
   * Both used to be the same amber, which is also close to the app's own Mars
   * orange, so the strip read as branding and someone glancing at a tab could
   * not tell staging from local at all. Staging is the one that matters:
   * it looks exactly like production, and a mission submitted there is test
   * data sitting in a real-looking feed. So staging is the loud one.
   *
   * Both are checked against white at well over the 4.5:1 needed for text
   * this size: rose is 6.29:1, indigo 9.93:1.
   */
  const { label, background } =
    environment === 'staging'
      ? {
          label: 'STAGING. Not the live site. Missions submitted here are test data.',
          background: '#be123c',
        }
      : {
          label: 'LOCAL DEVELOPMENT',
          background: '#3730a3',
        };

  return (
    <div
      role="status"
      style={{
        background,
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
