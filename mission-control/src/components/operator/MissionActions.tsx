'use client';

import { useState } from 'react';
import { Check, Loader2, Trash2, Video, X } from 'lucide-react';

import type { QueueMission } from '@/lib/services/operatorQueueService';

/**
 * The five desk actions for one mission (AB#379).
 *
 * Deliberately inside the expanded panel rather than on the row. An operator
 * about to cancel or delete a child's work should have that child's code in
 * front of them, and putting five buttons on every row would also make the
 * queue unscannable on a phone, which is what an operator is holding at an
 * event.
 *
 * NOT ONE OF THESE REACHES A ROVER. Send, rerun, stop, camera and arming all
 * stay on the satellite, because they are physical and stop in particular has
 * to work with no internet. These settle the record, which is a desk job and
 * therefore belongs somewhere that works when the yard's network does not.
 */

type Action = 'complete' | 'cancel' | 'attach-video' | 'resolve';

export function MissionActions({
  mission,
  yardId,
  isAdmin,
  onResult,
}: {
  mission: QueueMission;
  yardId: string;
  isAdmin: boolean;
  onResult: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const settled = mission.status === 'completed' || mission.status === 'cancelled';

  async function run(action: Action, key: string, body: Record<string, unknown> = {}) {
    setPending(key);
    setError(null);

    try {
      const response = await fetch(`/api/operator/missions/${mission.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, yardId, ...body }),
      });
      const result = await response.json();

      if (!response.ok) {
        // The server's message, not a generic one. A 409 says something true
        // and specific ("this mission is already completed"), usually because
        // another operator got there first, and replacing that with "something
        // went wrong" would send someone looking for a bug that is not there.
        setError(result.error ?? 'That did not work.');
        return;
      }

      onResult(successMessage(action, mission.name));
    } catch {
      // The console is the thing that is supposed to work when the yard's
      // network does not, so its own network failure is worth naming plainly.
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    setPending('delete');
    setError(null);

    try {
      const response = await fetch(`/api/operator/missions/${mission.id}`, { method: 'DELETE' });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }

      onResult(`Deleted ${mission.name || 'the mission'}.`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(null);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="mt-3 space-y-2.5 border-t border-border/50 pt-3">
      {/* A flagged mission asks a question, so it gets asked first and on its
          own. The endpoint behind this has existed since recovery shipped with
          no way to reach it, so these flags have only ever been clearable by
          someone with a shell on the Pi. */}
      {mission.needsReview && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-foreground">
            The satellite could not tell what happened here.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mission.reviewReason ?? 'It stopped while this mission was running.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton
              label="It finished"
              busy={pending === 'resolve-completed'}
              onClick={() => run('resolve', 'resolve-completed', { outcome: 'completed' })}
            />
            <ActionButton
              label="Put it back in the queue"
              busy={pending === 'resolve-requeue'}
              onClick={() => run('resolve', 'resolve-requeue', { outcome: 'requeue' })}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Putting it back makes it available to send again. It does not send it.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!settled && (
          <>
            <ActionButton
              icon={<Check className="h-3 w-3" />}
              label="Mark complete"
              busy={pending === 'complete'}
              onClick={() => run('complete', 'complete')}
            />
            <ActionButton
              icon={<X className="h-3 w-3" />}
              label="Cancel"
              busy={pending === 'cancel'}
              onClick={() => run('cancel', 'cancel')}
            />
          </>
        )}

        {isAdmin && (
          <div className="ml-auto">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-destructive">
                  Delete permanently?
                </span>
                <ActionButton label="Yes, delete" busy={pending === 'delete'} onClick={remove} danger />
                <ActionButton label="Keep it" onClick={() => setConfirmingDelete(false)} />
              </div>
            ) : (
              <ActionButton
                icon={<Trash2 className="h-3 w-3" />}
                label="Delete"
                onClick={() => setConfirmingDelete(true)}
                danger
              />
            )}
          </div>
        )}
      </div>

      {/* Cancel is bookkeeping, and saying so is the whole reason it is safe to
          offer on a running mission. An operator who thinks this stops a rover
          would use it as an emergency control, and it is not one. */}
      {!settled && (
        <p className="text-[11px] text-muted-foreground">
          These record what happened. Nothing here reaches the rover, so use the
          yard&apos;s own stop button if it is still moving.
        </p>
      )}

      {mission.status === 'completed' && (
        <div className="rounded-xl border border-border/50 bg-background/40 p-3">
          <label
            htmlFor={`video-${mission.id}`}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
          >
            <Video className="h-3.5 w-3.5 text-primary" />
            {mission.youtubeUrl ? 'Replace the video' : 'Attach the video'}
          </label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {mission.youtubeUrl
              ? 'A video is already attached. Pasting a new link replaces it.'
              : 'Upload the recording to YouTube, then paste the link here.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`video-${mission.id}`}
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://youtu.be/..."
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <ActionButton
              label="Attach"
              busy={pending === 'attach-video'}
              disabled={url.trim().length === 0}
              onClick={() => run('attach-video', 'attach-video', { url: url.trim() })}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function successMessage(action: Action, name?: string): string {
  const mission = name || 'the mission';
  switch (action) {
    case 'complete':
      return `Marked ${mission} complete.`;
    case 'cancel':
      return `Cancelled ${mission}. The record is kept.`;
    case 'attach-video':
      return `Attached the video to ${mission}.`;
    case 'resolve':
      return `Resolved the review on ${mission}.`;
  }
}

function ActionButton({
  icon,
  label,
  busy,
  disabled,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'border-destructive/40 text-destructive hover:border-destructive/70'
          : 'border-border/60 text-foreground hover:border-primary/70'
      }`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}
