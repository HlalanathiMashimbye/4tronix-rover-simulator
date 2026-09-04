/**
 * Where this operator's yard console lives.
 *
 * Mission Control runs in the cloud; the console runs on the satellite in the
 * room, on a private network Mission Control cannot see or reach. So this is
 * not something the server can know or store - it is a property of where the
 * operator is standing, and it is kept in their own browser.
 *
 * That is also why it is not a runtime setting: those live in Secret Manager
 * with a Terraform resource each, which is a heavy and shared home for a LAN
 * address that differs per person and per venue.
 *
 * The default is the satellite's mDNS name, which is stable now that the
 * satellite serves the yard's wifi itself rather than joining a laptop's
 * hotspot (see yard/docs/yard-network.md).
 */

const STORAGE_KEY = 'yard:consoleUrl';

/** The satellite's own name on the yard network, plus the run station path. */
export const DEFAULT_CONSOLE_URL = 'http://mro.local:3001/run/';

/**
 * Normalise what somebody typed into something openable.
 *
 * Returns null for anything that is not a plain http(s) address, so a stored
 * value can never become a `javascript:` link on a button the operator clicks.
 */
export function normaliseConsoleUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) ? text : `http://${text}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;

  return parsed.toString();
}

/** The console address for this browser, falling back to the default. */
export function readConsoleUrl(): string {
  try {
    return normaliseConsoleUrl(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_CONSOLE_URL;
  } catch {
    // Private mode, or storage disabled. The default is still useful.
    return DEFAULT_CONSOLE_URL;
  }
}

/** Remember an address, or forget it when given nothing. Returns what stuck. */
export function writeConsoleUrl(raw: string | null | undefined): string {
  const url = normaliseConsoleUrl(raw);
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the button still works for this session.
  }
  return url ?? DEFAULT_CONSOLE_URL;
}
