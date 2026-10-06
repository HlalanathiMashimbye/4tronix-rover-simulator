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
 * The other door out of the console: where the run video gets uploaded.
 *
 * Not configurable, unlike the address above: Studio is the same for
 * everyone, and the channel it opens is whichever the operator is signed
 * into. It lives here because the two doors are offered together - in the
 * queue's toolbar on a laptop and in the overflow menu on a phone - and a
 * constant that two components each declare is two constants.
 */
export const YOUTUBE_STUDIO_URL = 'https://studio.youtube.com/';

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

/**
 * An address on the satellite's own API, such as `/api/status`, beside the
 * console this browser is pointed at.
 */
export function yardApiUrl(path: string, consoleUrl: string = readConsoleUrl()): string {
  const url = new URL(consoleUrl);
  url.pathname = path;
  url.search = '';
  return url.toString();
}

export type LocalNetworkPermission = PermissionStatus | 'unsupported';

/**
 * This browser's local network access permission for the page.
 *
 * Chromium browsers (Chrome, Edge) ask before an https page may call a device
 * on the local network, such as the satellite, and only then let the request
 * through. Safari and Firefox have no such permission and simply block it.
 * Chrome has used both names, so each is tried; an unknown name throws.
 *
 * Here rather than in one component because two things now call the yard from
 * Mission Control, the send checks and the completion listener, and both must
 * refuse to reach for it in a way that would pop a prompt nobody asked for.
 */
export async function localNetworkPermission(): Promise<LocalNetworkPermission> {
  if (!navigator.permissions?.query) return 'unsupported';
  for (const name of ['local-network', 'local-network-access']) {
    try {
      return await navigator.permissions.query({ name: name as PermissionName });
    } catch {
      // Not a permission this browser knows; try the next name.
    }
  }
  return 'unsupported';
}

/**
 * Whether the browser itself stops this page from calling the satellite: an
 * https page may not fetch an http address unless a local network permission
 * lets it, and a browser without that permission never will.
 */
export function browserBlocksYard(consoleUrl: string): boolean {
  return window.location.protocol === 'https:' && new URL(consoleUrl).protocol === 'http:';
}
