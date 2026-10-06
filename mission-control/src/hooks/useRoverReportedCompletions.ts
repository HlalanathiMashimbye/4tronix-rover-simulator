'use client';

import { useEffect, useRef } from 'react';

import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';
import { finishedRuns, missionsTheRoverFinished } from '@/core/domain/services/roverReports';
import { localNetworkPermission, readConsoleUrl, yardApiUrl } from '@/lib/yardConsole';

/**
 * Marks a mission complete when the rover reports it finished.
 *
 * Mark complete was greyed out on the promise that "the rover reports when it
 * has finished", and nothing did. The rover does know, and says so in its queue
 * history, but it only says so on the yard network, and the satellite has no
 * credential to write to Firestore. The operator's open console is the one
 * place that can hear the yard AND is signed in to Mission Control, so it is
 * the one that records it, through the same operator route a click would use.
 *
 * Runs while the console is open, whichever mission is selected, and catches
 * up when the operator comes back from the run station: the rover keeps its
 * recent history. If nobody has the console open at all, the YouTube linker
 * completes the mission when its video is found.
 */

/** Matches the yard checks, for the same reason: the Pi pays for every read. */
export const COMPLETION_POLL_MS = 15_000;
const READ_TIMEOUT_MS = 10_000;

function reportedKey(yardId: string): string {
  return `yard:reportedRuns:${yardId}`;
}

/**
 * Instruction ids already acted on, kept in this browser.
 *
 * The rover keeps finished runs in its history, so without this every poll
 * would complete the mission again - and after "another run" was logged, would
 * complete the new attempt using the old report.
 */
function loadReported(yardId: string): Set<string> {
  try {
    const raw = localStorage.getItem(reportedKey(yardId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveReported(yardId: string, reported: Set<string>): void {
  try {
    // The rover keeps 50 finished instructions; remembering more is pointless.
    localStorage.setItem(reportedKey(yardId), JSON.stringify([...reported].slice(-100)));
  } catch {
    // Storage refused: the server still refuses to complete a mission twice.
  }
}

async function readRoverHistory(consoleUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetch(yardApiUrl('/api/queue/status', consoleUrl), {
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function useRoverReportedCompletions({
  yardId,
  missions,
  onCompleted,
}: {
  yardId: string;
  missions: QueueMission[] | null;
  onCompleted: (mission: QueueMission) => void;
}): void {
  // Read through refs so the poll is not torn down and restarted every time
  // the queue subscription delivers a new array.
  const missionsRef = useRef(missions);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    missionsRef.current = missions;
    onCompletedRef.current = onCompleted;
  });

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const reported = loadReported(yardId);

    async function poll() {
      if (cancelled || inFlight || document.hidden) return;
      const queue = missionsRef.current ?? [];
      if (!queue.some((m) => m.status === 'queued' || m.status === 'processing')) return;

      inFlight = true;
      try {
        // Only where the browser already lets this page reach the yard. A
        // background poll must never be what pops the permission prompt.
        const consoleUrl = readConsoleUrl();
        const permission = await localNetworkPermission();
        if (permission === 'unsupported' || permission.state !== 'granted' || cancelled) return;

        const toComplete = missionsTheRoverFinished(finishedRuns(await readRoverHistory(consoleUrl)), queue, reported);
        for (const run of toComplete) {
          if (cancelled) return;
          const response = await fetch(`/api/operator/missions/${run.missionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'complete', yardId }),
          });
          // 409 is "already complete": someone else recorded it, which is also
          // a report that no longer needs acting on.
          if (response.ok || response.status === 409) {
            reported.add(run.instructionId);
            saveReported(yardId, reported);
          }
          const mission = queue.find((m) => m.id === run.missionId);
          if (response.ok && mission) onCompletedRef.current(mission);
        }
      } catch {
        // An unreachable yard or a dropped request waits for the next poll.
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const interval = window.setInterval(poll, COMPLETION_POLL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [yardId]);
}
