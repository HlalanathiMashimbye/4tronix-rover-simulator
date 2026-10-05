'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Camera, Check, Copy, Crosshair, Loader2, Rocket, RotateCcw, Video, WifiOff, X } from 'lucide-react';

import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';
import { browserBlocksYard, localNetworkPermission, readConsoleUrl, yardApiUrl } from '@/lib/yardConsole';
import { missionClipboardText } from '@/lib/missionClipboard';

/** How to put the rover on the start mark: the tape in the yard says where. */
const START_MARK_HOW = 'Centre it where the arrow crosses the seam, nose along the arrow.';

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
    return await fetch(yardApiUrl('/api/status', consoleUrl), { cache: 'no-store', signal: controller.signal });
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

/** Each yard check's icon, by its key. */
const CHECK_ICON: Record<string, typeof Camera> = { camera: Camera, rover: Bot, recording: Video };
/** Each check state's colours; anything not ready or failed is still unknown. */
const CHECK_STATE_CLASS: Record<string, string> = {
  ready: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  unknown: 'border-border/60 bg-background/60 text-muted-foreground',
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
      const params = new URLSearchParams({
        handoff: 'automatic',
        yardId,
        missionId: mission.id,
        missionName: mission.name || '',
        code: mission.code,
        // Where the console's "Mission Control" link returns to: this mission,
        // open, rather than Mission Control's home page, which is the learner
        // feed. The console only follows it back to this origin.
        returnTo: `${window.location.origin}/operator?mission=${encodeURIComponent(mission.id)}`,
      });
      // The theme on screen right now, so the console opens in it. The console
      // is on another address and cannot read the operator's choice from here;
      // without this it falls back to the laptop's setting, which is wrong for
      // anyone who picked the other theme in Mission Control.
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme === 'light' || theme === 'dark') params.set('theme', theme);
      target.search = params.toString();
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
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-2.5" aria-labelledby="automatic-dispatch-title">
      {/* ONE ROW: what this is, the three checks, and the buttons. It was a
          heading, a sentence, a row of three cards and the buttons, about
          170px before any warning, and with the mission preview above it
          Send to Rover ended up below the fold on a laptop. The sentence
          lives on as a tooltip on Send and for screen readers. Wraps on a
          phone, where the buttons take their own line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="automatic-dispatch-title" className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-foreground">
          <Rocket className="h-4 w-4 text-primary" />
          {/* Words only where there is room: in a phone's panel the icons
              and Send to Rover need the row. */}
          <span className="@max-md:sr-only">Yard checks</span>
        </h3>
        <p id="automatic-dispatch-help" className="sr-only">
          {live
            ? 'Checked every 15 seconds. Send to Rover unlocks when all three are ready.'
            : 'Send to Rover unlocks when every check below is ready.'}
        </p>

        {/* Icons, coloured by state: the three checks are read at a glance
            many times a session, and their words took most of the row. The
            label and status stay in the chip for screen readers and as the
            tooltip, with the fix when a check has failed. */}
        <div className="flex items-center gap-1" aria-live="polite">
          {checks.map((check) => {
            const Icon = CHECK_ICON[check.key] ?? Rocket;
            return (
              <div
                key={check.key}
                title={`${check.label}: ${check.status}${check.state === 'failed' ? `. ${check.fix}` : ''}`}
                data-state={check.state}
                className={`relative flex h-7 w-7 items-center justify-center rounded-full border ${CHECK_STATE_CLASS[check.state] ?? CHECK_STATE_CLASS.unknown}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {check.state === 'ready' && <Check className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-600 p-0.5 text-white" aria-hidden="true" />}
                {check.state === 'failed' && <X className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-destructive p-0.5 text-white" aria-hidden="true" />}
                <span className="sr-only">{check.label}</span>
                <span className="sr-only">{check.status}</span>
              </div>
            );
          })}
        </div>

        {/* The start mark (AB#465). A run starts from wherever the rover is
            standing, and where it is standing is the one thing none of the
            checks can see. A reminder, not a gate: it is the operator's hand
            on the rover, and a box ticked before every run stops being read.
            The how is the tooltip and for screen readers; the yard's run
            station says the same beside its own Send. */}
        <p
          data-testid="start-mark-reminder"
          title={START_MARK_HOW}
          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-foreground"
        >
          <Crosshair className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          Rover on the start mark?
          <span className="sr-only">{START_MARK_HOW}</span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!live && !unreachable && (
            <button
              type="button"
              onClick={() => readYard(false)}
              disabled={checking}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {checking ? 'Checking yard...' : 'Check yard'}
            </button>
          )}
          <button
            type="button"
            onClick={() => readYard(true)}
            disabled={checking || !mission.code || !allReady}
            aria-describedby="automatic-dispatch-help"
            title={allReady ? undefined : 'Unlocks when every yard check is ready'}
            className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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

      {showNotReady && (
        <div className="mt-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs" data-testid="yard-not-ready">
          <p className="font-semibold text-foreground">Not ready to send yet</p>
          {notReady.map((check) => (
            <p key={check.key} className="mt-1 text-muted-foreground">
              <span className="font-semibold text-foreground">{check.label}:</span> {check.fix}
            </p>
          ))}
        </div>
      )}

      {unreachable && (
        // Compact, with its actions on the same line as the explanation:
        // it is the usual state on a laptop away from the yard, and it was
        // the tallest thing in the panel.
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          {/* The title on the line, the how-to-fix as its tooltip and for
              screen readers: an operator needs to see that it is blocked and
              what to press, and reads the steps once. */}
          <div className="min-w-0 flex-1" title={UNREACHABLE_MESSAGES[unreachable].body}>
            {/* Wraps in a phone's panel rather than losing its end: "is
                blocked" is the part that says what is wrong. */}
            <h4 className="truncate text-xs font-bold text-foreground @max-md:whitespace-normal @max-md:leading-tight">{UNREACHABLE_MESSAGES[unreachable].title}</h4>
            <p className="sr-only">{UNREACHABLE_MESSAGES[unreachable].body}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Short on a phone, so the warning's title still fits beside
                them; the accessible names stay whole. */}
            <button
              type="button"
              onClick={copyCode}
              disabled={!mission.code}
              aria-label={copied ? 'Copied' : 'Copy for the run station'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="@max-md:hidden">{copied ? 'Copied' : 'Copy for the run station'}</span>
              <span className="hidden @max-md:inline">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            {/* Trying again cannot change which browser this is. */}
            {unreachable !== 'browser-cannot' && (
              <button
                type="button"
                onClick={() => readYard(false)}
                disabled={checking}
                aria-label="Try again"
                title="Try again"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70"
              >
                <RotateCcw className="hidden h-3.5 w-3.5 @max-md:block" aria-hidden="true" />
                <span className="@max-md:hidden">Try again</span>
              </button>
            )}
          </div>
        </div>
      )}

      {success && (
        <p role="status" className="mt-2 rounded-xl border border-emerald-600/30 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-700">
          All checks passed. Starting mission...
        </p>
      )}

      {(failures.length > 0 || error) && !dismissed && (
        <div role="alertdialog" aria-labelledby="dispatch-failure-title" className="mt-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
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
