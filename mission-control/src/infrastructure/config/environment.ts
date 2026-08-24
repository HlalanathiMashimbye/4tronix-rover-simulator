/**
 * Which deployment this is: "prod", "staging", or local development.
 *
 * Read at runtime from APP_ENV, set per Cloud Run service by Terraform. It
 * carries no NEXT_PUBLIC_ prefix on purpose: prod promotes the exact image
 * digest built during the staging deploy, and Next freezes every NEXT_PUBLIC_*
 * value at build time, so a public variable would permanently label production
 * as staging. Same reasoning as appUrl.ts.
 */
export type AppEnvironment = 'prod' | 'staging' | 'development';

export function resolveEnvironment(): AppEnvironment {
  const raw = process.env.APP_ENV?.trim().toLowerCase();

  if (raw === 'prod' || raw === 'production') {
    return 'prod';
  }
  if (raw === 'staging') {
    return 'staging';
  }

  // Unset means either local development or a deploy that predates APP_ENV.
  // Defaulting to non-production is the safe direction: a mislabelled prod is
  // embarrassing, an unlabelled staging is how someone dispatches a rover from
  // the wrong environment.
  return 'development';
}

export function isProduction(): boolean {
  return resolveEnvironment() === 'prod';
}
