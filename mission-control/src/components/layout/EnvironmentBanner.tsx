import { resolveEnvironment } from '@/infrastructure/config/environment';

/**
 * A strip across the top of every non-production page.
 *
 * Server component, so the environment is read at request time and never baked
 * into the bundle. Renders nothing at all in production rather than rendering
 * a hidden element, so there is no prod markup to leak or mis-style.
 */
export function EnvironmentBanner() {
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
