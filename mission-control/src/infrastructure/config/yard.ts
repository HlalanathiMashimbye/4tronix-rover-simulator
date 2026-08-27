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
 * The value now comes from the yard registry in ./yards rather than a second
 * literal here. Renaming the yard to `curiosity` briefly created three copies
 * of the same string, which is the failure this file was written to prevent,
 * so the write path and the display path now read the same entry. The Python
 * copy remains, and cannot be removed while the satellite is a separate
 * process in another language, so it carries a comment pointing back here.
 *
 * NEXT_PUBLIC_ is correct here, unlike APP_URL: the value is identical in every
 * environment we deploy, it is not a secret (it is already stored in plain text
 * on every public mission document), and it is read in a client component. See
 * infrastructure/config/appUrl.ts for the case where the build-time freeze is a
 * problem rather than a non-issue.
 */
import { DEFAULT_YARD_ID as REGISTRY_DEFAULT } from './yards';

export const DEFAULT_YARD_ID = REGISTRY_DEFAULT;

export function resolveYardId(): string {
  return process.env.NEXT_PUBLIC_YARD_ID?.trim() || DEFAULT_YARD_ID;
}
