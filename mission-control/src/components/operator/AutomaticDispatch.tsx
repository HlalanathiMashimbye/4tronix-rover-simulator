'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Loader2, Rocket, WifiOff, X } from 'lucide-react';

import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';
import { readConsoleUrl } from '@/lib/yardConsole';
import { missionClipboardText } from '@/lib/missionClipboard';

type CheckKey = 'camera' | 'rover' | 'recording';
type CheckState = 'waiting' | 'ready' | 'failed';

type YardStatus = {
  camera?: { ready?: boolean; detail?: string };
  rover?: { reachable?: boolean; status?: string | null };
  recording?: { ready?: boolean; detail?: string };
};

type CheckResult = {
  key: CheckKey;
  label: string;
  state: CheckState;
  status: string;
  fix: string;
};

const CHECKS: Record<CheckKey, Omit<CheckResult, 'state' | 'status'>> = {
  camera: {
    key: 'camera',
    label: 'Camera',
    fix: 'Check that the yard camera is connected and available, then try again.',
  },
  rover: {
    key: 'rover',
    label: 'Rover',
    fix: 'Check that the rover is powered on and connected to the satellite, then try again.',
  },
  recording: {
    key: 'recording',
    label: 'Recording',
    fix: 'Check that the camera recording service is available, then try again.',
  },
};

function initialChecks(): CheckResult[] {
  return (Object.keys(CHECKS) as CheckKey[]).map((key) => ({
    ...CHECKS[key],
    state: 'waiting',
    status: 'Not checked',
  }));
}

/** What the satellite's status says about each check. */
function readChecks(status: YardStatus): CheckResult[] {
  return (Object.keys(CHECKS) as CheckKey[]).map((key): CheckResult => {
    const ready = key === 'camera'
      ? status.camera?.ready === true
      : key === 'rover'
        ? status.rover?.reachable === true && (status.rover.status == null || status.rover.status === 'ok')
        : status.recording?.ready === true;
    const detail = key === 'camera' ? status.camera?.detail : status.recording?.detail;
    return {
      ...CHECKS[key],
      state: ready ? 'ready' : 'failed',
      status: ready ? 'Ready' : (detail || (key === 'rover' ? 'Not reachable' : 'Not ready')),
    };
  });
}

/**
 * How often an open mission re-reads the yard's checks.
 *
 * The request goes from this browser to the satellite on the yard network, so
 * it costs nothing in Firestore or Cloud Run. The price is paid by the Pi: a
 * status read asks the rover for its health, which takes about six seconds
 * while the rover is switched off, so this stays well clear of that.
 */
const LIVE_CHECK_INTERVAL_MS = 15_000;

function statusUrl(consoleUrl: string): string {
  const url = new URL(consoleUrl);
  url.pathname = '/api/status';
  url.search = '';
  return url.toString();
}

/**
 * How long to wait for the satellite before calling the yard offline.
 *
 * Ten seconds, not two. A satellite whose saved rover is switched off takes
 * about six seconds to answer, while it gives up looking the rover's name up,
 * and a shorter limit would call a working yard offline.
 */
const STATUS_TIMEOUT_MS = 10_000;

/**
 * How long to wait while the browser is still asking the operator whether this
 * site may reach the local network. The ten-second limit starts once they
 * answer; this only stops a prompt left open from spinning forever.
 */
const PERMISSION_PROMPT_TIMEOUT_MS = 120_000;

/** Why the yard did not answer, which decides what the operator is told to do. */
type Unreachable = 'offline' | 'permission-denied' | 'browser-cannot';

type LocalNetworkPermission = PermissionStatus | 'unsupported';

/**
 * This browser's local network access permission for the page.
 *
 * Chromium browsers (Chrome, Edge) ask before an https page may call a device
 * on the local network, such as the satellite, and only then let the request
 * through. Safari and Firefox have no such permission and simply block it.
 * Chrome has used both names, so each is tried; an unknown name throws.
 */
async function localNetworkPermission(): Promise<LocalNetworkPermission> {
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
function browserBlocksYard(consoleUrl: string): boolean {
  return window.location.protocol === 'https:' && new URL(consoleUrl).protocol === 'http:';
}

/**
 * The satellite's status response, or why this browser could not get one.
 *
 * "Yard offline" is only the answer when the browser could have reached the
 * yard. Telling a Safari user the yard is offline sends them to check a yard
 * that is fine, when the way forward is a different browser.
 */
async function reachYard(): Promise<Response | Unreachable> {
  const consoleUrl = readConsoleUrl();
  const permission = await localNetworkPermission();
  if (permission !== 'unsupported' && permission.state === 'denied') return 'permission-denied';

  const controller = new AbortController();
  let timer = window.setTimeout(
    () => controller.abort(),
    permission !== 'unsupported' && permission.state === 'prompt' ? PERMISSION_PROMPT_TIMEOUT_MS : STATUS_TIMEOUT_MS,
  );
  if (permission !== 'unsupported' && permission.state === 'prompt') {
    // The request waits on the operator's answer, so the clock for the yard
    // starts when they give one, not when the prompt appeared.
    permission.onchange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    };
  }

  try {
    return await fetch(statusUrl(consoleUrl), { cache: 'no-store', signal: controller.signal });
  } catch {
    if (permission !== 'unsupported' && permission.state === 'denied') return 'permission-denied';
    if (permission === 'unsupported' && browserBlocksYard(consoleUrl)) return 'browser-cannot';
    return 'offline';
  } finally {
    window.clearTimeout(timer);
    if (permission !== 'unsupported') permission.onchange = null;
  }
}

/**
 * What the operator is told when the yard cannot be read. These can show the
 * moment a mission opens, before anyone has pressed anything, so none of them
 * talks about a send that was never attempted.
 */
const UNREACHABLE_MESSAGES: Record<Unreachable, { title: string; body: string }> = {
  offline: {
    title: 'Yard offline',
    body: 'This browser cannot reach the yard right now. Copy the mission and paste it into the run station at the yard instead.',
  },
  'permission-denied': {
    title: 'Local network access is blocked',
    body: 'This browser is not allowed to reach the yard. Click the lock beside the address, open the permissions for this site, set Local network access to Allow, then try again. Or copy the mission and paste it into the run station.',
  },
  'browser-cannot': {
    title: 'This browser cannot reach the yard',
    body: 'Sending automatically needs a browser like Chrome or Edge, which can ask for local network access. Open Mission Control in one of them, or copy the mission and paste it into the run station.',
  },
};

export function AutomaticDispatch({
  mission,
  yardId,
  navigate = (url) => window.location.assign(url),
}: {
  mission: QueueMission;
  yardId: string;
  navigate?: (url: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<CheckResult[]>(initialChecks);
  const [failures, setFailures] = useState<CheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showRocketFeedback, setShowRocketFeedback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unreachable, setUnreachable] = useState<Unreachable | null>(null);
  // Whether this browser has shown it can reach the yard without asking, so
  // re-reading the checks in the background cannot pop a permission prompt at
  // an operator who has only opened a mission.
  const [live, setLive] = useState(false);
  const checkingRef = useRef(false);
  // When the yard was last read, by either path. A button turning the live
  // checks on would otherwise read the yard twice in the same second.
  const lastReadRef = useRef(0);

  // Send to Rover is only offered against a yard that has said it is ready.
  // Pressing it still reads the yard again: a check from seconds ago is not a
  // reason to move a robot.
  const allReady = checks.every((check) => check.state === 'ready');

  useEffect(() => {
    // Everything the browser can say without asking the operator is said on
    // opening, so nobody presses Send to Rover to learn Safari cannot send.
    let cancelled = false;
    void localNetworkPermission().then((permission) => {
      if (cancelled) return;
      if (permission === 'unsupported') {
        if (browserBlocksYard(readConsoleUrl())) setUnreachable('browser-cannot');
      } else if (permission.state === 'granted') {
        setLive(true);
      } else if (permission.state === 'denied') {
        setUnreachable('permission-denied');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let inFlight = false;

    async function refresh() {
      // A hidden tab has nobody reading it, and a button's own read must not
      // be overwritten by a background one halfway through.
      if (cancelled || inFlight || checkingRef.current || document.hidden) return;
      if (Date.now() - lastReadRef.current < LIVE_CHECK_INTERVAL_MS / 2) return;
      inFlight = true;
      lastReadRef.current = Date.now();
      try {
        const response = await reachYard();
        if (cancelled || checkingRef.current) return;
        if (typeof response === 'string') {
          setUnreachable(response);
          if (response !== 'offline') {
            setLive(false);
            setChecks(initialChecks());
            return;
          }
          setChecks(initialChecks().map((check) => ({ ...check, state: 'failed', status: 'No answer' })));
          return;
        }
        if (!response.ok) return;
        const status = (await response.json()) as YardStatus;
        if (cancelled || checkingRef.current) return;
        setUnreachable(null);
        setChecks(readChecks(status));
      } catch {
        // A background read that goes wrong waits for the next one.
      } finally {
        inFlight = false;
      }
    }

    void refresh();
    const interval = window.setInterval(refresh, LIVE_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [live]);

  async function copyCode() {
    const envelope = missionClipboardText(mission);
    try {
      await navigator.clipboard.writeText(envelope);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for insecure origins
      window.prompt('Copy this, then paste it into the yard code editor:', envelope);
    }
  }

  /**
   * Read the yard, and with `send` go on to the run station if it is ready.
   *
   * Without `send` this is Check yard: the first read in a browser that has
   * not yet been allowed onto the local network, which is where the browser's
   * own prompt appears. After that the live checks take over.
   */
  async function readYard(send: boolean) {
    checkingRef.current = true;
    setChecking(true);
    setError(null);
    setFailures([]);
    setUnreachable(null);
    setSuccess(false);
    setDismissed(false);
    setChecks(initialChecks().map((check) => ({ ...check, status: 'Checking...' })));

    try {
      // Step one: is the yard there at all? Unreachable is a different
      // situation from a yard whose camera is not ready, with a different way
      // forward, so it is decided before any check is read.
      const response = await reachYard();
      lastReadRef.current = Date.now();
      if (typeof response === 'string') {
        setUnreachable(response);
        setChecks(initialChecks());
        if (response !== 'offline') setLive(false);
        return;
      }
      // Reached without being stopped, so later reads cannot prompt either.
      setLive(true);

      // Step two: the yard answered, so read what it says about itself.
      const status = (await response.json()) as YardStatus;
      if (!response.ok) throw new Error('The satellite returned an error while checking the yard.');

      const next = readChecks(status);
      setChecks(next);
      if (!send) return;

      // Ready a moment ago and not now: say so rather than send.
      const failed = next.filter((check) => check.state === 'failed');
      if (failed.length > 0) {
        setFailures(failed);
        return;
      }

      setSuccess(true);
      setShowRocketFeedback(true);
      const target = new URL(readConsoleUrl());
      target.pathname = '/run/';
      target.search = new URLSearchParams({
        handoff: 'automatic',
        yardId,
        missionId: mission.id,
        missionName: mission.name || '',
        code: mission.code,
      }).toString();
      window.setTimeout(() => navigate(target.toString()), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not check the satellite.');
      setFailures([]);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  const notReady = checks.filter((check) => check.state === 'failed');
  const showNotReady = !checking && !unreachable && !success && notReady.length > 0 && (failures.length === 0 || dismissed);

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3" aria-labelledby="automatic-dispatch-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="automatic-dispatch-title" className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <Rocket className="h-4 w-4 text-primary" />
            Yard checks
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {live
              ? 'Checked every 15 seconds. Send to Rover unlocks when all three are ready.'
              : 'Send to Rover unlocks when every check below is ready.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!live && !unreachable && (
            <button
              type="button"
              onClick={() => readYard(false)}
              disabled={checking}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {checking ? 'Checking yard...' : 'Check yard'}
            </button>
          )}
          <button
            type="button"
            onClick={() => readYard(true)}
            disabled={checking || !mission.code || !allReady}
            title={allReady ? undefined : 'Unlocks when every yard check is ready'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking && live ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            Send to Rover
          </button>
          <button
            type="button"
            onClick={copyCode}
            disabled={!mission.code}
            aria-label={copied ? 'Copied' : 'Copy mission code'}
            title={copied ? 'Copied!' : 'Copy mission code for manual workflow'}
            className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-background/60 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-3" aria-live="polite">
        {checks.map((check) => (
          <div key={check.key} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-2 text-xs">
            {check.state === 'ready' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : check.state === 'failed' ? <X className="h-3.5 w-3.5 text-destructive" /> : <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
            <span className="font-semibold text-foreground">{check.label}</span>
            <span className="ml-auto text-muted-foreground">{check.status}</span>
          </div>
        ))}
      </div>

      {showNotReady && (
        <div className="mt-3 rounded-xl border border-border/60 bg-background/50 p-3 text-xs" data-testid="yard-not-ready">
          <p className="font-semibold text-foreground">Not ready to send yet</p>
          {notReady.map((check) => (
            <p key={check.key} className="mt-1 text-muted-foreground">
              <span className="font-semibold text-foreground">{check.label}:</span> {check.fix}
            </p>
          ))}
        </div>
      )}

      {unreachable && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-foreground">{UNREACHABLE_MESSAGES[unreachable].title}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{UNREACHABLE_MESSAGES[unreachable].body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyCode}
                  disabled={!mission.code}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy for the run station'}
                </button>
                {/* Trying again cannot change which browser this is. */}
                {unreachable !== 'browser-cannot' && (
                  <button
                    type="button"
                    onClick={() => readYard(false)}
                    disabled={checking}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {success && (
        <p role="status" className="mt-3 rounded-xl border border-emerald-600/30 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-700">
          All checks passed. Starting mission...
        </p>
      )}

      {(failures.length > 0 || error) && !dismissed && (
        <div role="alertdialog" aria-labelledby="dispatch-failure-title" className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <h4 id="dispatch-failure-title" className="text-sm font-bold text-foreground">Unable to send mission</h4>
              <p className="mt-1 text-xs text-muted-foreground">{error || 'The following yard checks failed:'}</p>
              {failures.map((failure) => (
                <div key={failure.key} className="mt-2 text-xs text-foreground">
                  <p className="font-semibold">{failure.label} - {failure.status}</p>
                  <p className="text-muted-foreground">Fix: {failure.fix}</p>
                </div>
              ))}
              <p className="mt-2 font-semibold text-destructive">The mission has NOT been sent to the rover.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setDismissed(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70">
                  Close
                </button>
                <button type="button" onClick={() => readYard(false)} disabled={checking} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70">
                  Retry
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRocketFeedback && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
          <div className="animate-ping">
            <Rocket className="h-16 w-16 text-emerald-500" />
          </div>
        </div>
      )}
    </section>
  );
}
