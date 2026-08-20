/**
 * Public origin of the learner app, resolved at RUNTIME.
 *
 * Deliberately prefers APP_URL over NEXT_PUBLIC_APP_URL. Next inlines every
 * NEXT_PUBLIC_* reference into the bundle when `next build` runs, and freezes
 * it there (next/docs 01-app/02-guides/environment-variables.md). Our prod
 * deploy promotes the exact image digest already serving on staging rather than
 * rebuilding, so a build-time value means prod ships staging's origin - and the
 * mission link in a learner's email would point at the staging domain.
 *
 * APP_URL carries no NEXT_PUBLIC_ prefix, so it stays a real runtime lookup and
 * Terraform can set it per environment on the Cloud Run service.
 *
 * NEXT_PUBLIC_APP_URL remains as a fallback for local dev and for any image
 * built before APP_URL was wired up.
 */
export function resolveAppUrl(): string {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const value = configured?.trim();

  return value ? value.replace(/\/+$/, '') : 'http://localhost:3000';
}
