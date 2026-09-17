'use client';

import { AlertTriangle } from 'lucide-react';

import type { LinkerStatus } from '@/core/domain/services/youtubeLinkSchedule';

/** "15:00": the operator is in the room, so their own clock is the right one. */
export function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

const WHERE_TO_LOOK = 'Check the YouTube API key and channel in Settings.';

/**
 * One line saying whether uploads are being matched to missions.
 *
 * A working checker is quiet grey text. One that has never run, or has missed
 * its time, is amber and says so, because that is the state that went a week
 * unnoticed: nothing is wrong with any one mission, and no video ever arrives.
 */
export function YouTubeLinkStatus({
  status,
  className = '',
}: {
  status: LinkerStatus | null;
  className?: string;
}) {
  if (!status) return null;

  if (status.state === 'on-schedule') {
    return (
      <span className={`text-[11px] text-muted-foreground ${className}`}>
        Uploads checked {clockTime(status.lastCheckedAt)} · next {clockTime(status.nextCheckAt)}
      </span>
    );
  }

  const text =
    status.state === 'never'
      ? 'Uploads not checked yet'
      : `Uploads last checked ${clockTime(status.lastCheckedAt)}`;
  const detail =
    status.state === 'never'
      ? `YouTube has never been read for new uploads. ${WHERE_TO_LOOK}`
      : `A check was due at ${clockTime(status.expectedAt)} and has not happened. ${WHERE_TO_LOOK}`;

  return (
    <span
      role="status"
      title={detail}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 ${className}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {text}
      <span className="sr-only">. {detail}</span>
    </span>
  );
}
