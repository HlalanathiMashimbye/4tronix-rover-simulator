'use client';

import { useEffect, useState } from 'react';

import { linkerStatus, nextCheckAfter, type LinkerStatus } from '@/core/domain/services/youtubeLinkSchedule';

/**
 * Whether YouTube uploads are being checked, for the operator console.
 *
 * FEW READS, ON PURPOSE. Each fetch is one Firestore document read, so this
 * does not poll. It reads when the console opens, when the operator comes back
 * to the tab, and once a couple of minutes after each scheduled check, so the
 * line moves on without a reload: at most four reads an hour while open.
 */

/** Long enough for the linker's own call, which takes around ten seconds. */
export const AFTER_CHECK_MS = 2 * 60_000;

interface Reading {
  lastCheckedAt: Date | null;
  intervalMinutes: number;
  /** When this was read: "overdue" is only ever judged against a fresh read. */
  readAt: Date;
}

/**
 * Reads made within this window share one request. The desktop toolbar and the
 * phone menu both show the line and are both mounted, and two components must
 * not mean two reads.
 */
const SHARE_MS = 30_000;
let shared: { at: number; pending: Promise<Reading | null> } | null = null;

function read(): Promise<Reading | null> {
  if (shared && Date.now() - shared.at < SHARE_MS) return shared.pending;
  shared = { at: Date.now(), pending: readOnce() };
  return shared.pending;
}

/** For tests, which each start from a console that has read nothing. */
export function forgetSharedReading(): void {
  shared = null;
}

async function readOnce(): Promise<Reading | null> {
  try {
    const response = await fetch('/api/operator/youtube-link', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { lastCheckedAt: string | null; intervalMinutes: number };
    return {
      lastCheckedAt: body.lastCheckedAt ? new Date(body.lastCheckedAt) : null,
      intervalMinutes: body.intervalMinutes,
      readAt: new Date(),
    };
  } catch {
    // No line is better than a wrong one; the next read tries again.
    return null;
  }
}

export function useYouTubeLinkStatus(): LinkerStatus | null {
  const [reading, setReading] = useState<Reading | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await read();
      if (next && !cancelled) setReading(next);
    };

    void refresh();
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // One read shortly after the next check is due. Each read replaces
  // `reading`, which schedules the one after.
  useEffect(() => {
    if (!reading) return;
    let cancelled = false;
    const nextCheck = nextCheckAfter(reading.lastCheckedAt, reading.intervalMinutes, reading.readAt);
    const timer = window.setTimeout(async () => {
      if (document.hidden) return;
      const next = await read();
      if (next && !cancelled) setReading(next);
    }, Math.max(0, nextCheck.getTime() - Date.now()) + AFTER_CHECK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reading]);

  return reading ? linkerStatus(reading.lastCheckedAt, reading.intervalMinutes, reading.readAt) : null;
}
