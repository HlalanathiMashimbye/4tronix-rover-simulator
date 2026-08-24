/**
 * Which yard this deployment submits missions to.
 *
 * Was the string literal 'uct-rover-1' inline in MissionWorkspace, with a
 * matching DEFAULT_YARD_ID on the satellite (yard/satellite/satellite_identity.py).
 * Two hardcoded copies of the same value in two languages is the setup that
 * silently breaks the day a second yard exists: the satellite pulls only its
 * own yardId, so a mismatch shows up as a permanently empty queue with nothing
 * logged to explain it.
 *
 * NEXT_PUBLIC_ is correct here, unlike APP_URL: the value is identical in every
 * environment we deploy, it is not a secret (it is already stored in plain text
 * on every public mission document), and it is read in a client component. See
 * infrastructure/config/appUrl.ts for the case where the build-time freeze is a
 * problem rather than a non-issue.
 */
export const DEFAULT_YARD_ID = 'uct-rover-1';

export function resolveYardId(): string {
  return process.env.NEXT_PUBLIC_YARD_ID?.trim() || DEFAULT_YARD_ID;
}
