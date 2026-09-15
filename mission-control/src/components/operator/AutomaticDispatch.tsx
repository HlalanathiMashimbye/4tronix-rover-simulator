'use client';

import { useState } from 'react';
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
 * The satellite's status response, or null when this browser cannot reach it.
 *
 * No response at all covers several causes: the satellite is off, this
 * browser is not on the yard network, or the browser refused the request (an
 * https page may not fetch an http satellite). Each means the automatic route
 * cannot run from here, and each has the same way forward, so they share one
 * answer rather than surfacing "Failed to fetch".
 */
async function reachYard(): Promise<Response | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    return await fetch(statusUrl(readConsoleUrl()), { cache: 'no-store', signal: controller.signal });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

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
  const [offline, setOffline] = useState(false);

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

  async function checkAndSend() {
    setChecking(true);
    setError(null);
    setFailures([]);
    setOffline(false);
    setSuccess(false);
    setDismissed(false);
    setChecks(initialChecks().map((check) => ({ ...check, status: 'Checking...' })));

    try {
      // Step one: is the yard there at all? Unreachable is a different
      // situation from a yard whose camera is not ready, with a different way
      // forward, so it is decided before any check is read.
      const response = await reachYard();
      if (!response) {
        setOffline(true);
        setChecks(initialChecks());
        return;
      }

      // Step two: the yard answered, so read what it says about itself.
      const status = (await response.json()) as YardStatus;
      if (!response.ok) throw new Error('The satellite returned an error while checking the yard.');

      const next = (Object.keys(CHECKS) as CheckKey[]).map((key): CheckResult => {
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
      setChecks(next);

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
      setChecking(false);
    }
  }

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3" aria-labelledby="automatic-dispatch-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="automatic-dispatch-title" className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <Rocket className="h-4 w-4 text-primary" />
            Automatic route
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">Check this yard before sending the mission.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={checkAndSend}
            disabled={checking || !mission.code}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {checking ? 'Checking yard...' : 'Send to Rover'}
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

      {offline && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-foreground">Yard offline</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                This browser could not reach the yard, so the mission has not been sent. Copy it
                and paste it into the run station at the yard instead.
              </p>
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
                <button
                  type="button"
                  onClick={checkAndSend}
                  disabled={checking}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70"
                >
                  Try again
                </button>
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
                <button type="button" onClick={checkAndSend} disabled={checking} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/70">
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