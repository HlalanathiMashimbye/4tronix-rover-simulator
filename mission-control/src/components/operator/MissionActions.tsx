'use client';

import { useState } from 'react';
import { Check, Loader2, MessageSquare, Trash2, X } from 'lucide-react';

import {
  automatedReason,
  isHandledAutomatically,
  type ConsoleMode,
} from '@/core/domain/services/consoleMode';
import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';

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

type Action = 'complete' | 'cancel' | 'resolve' | 'feedback';

export function MissionActions({
  mission,
  yardId,
  isAdmin,
  mode = 'manual',
  onResult,
}: {
  mission: QueueMission;
  yardId: string;
  isAdmin: boolean;
  /**
   * Manual until the platform is doing this itself. In auto the bookkeeping
   * actions grey out and say why, rather than vanishing and leaving an
   * operator wondering where the button went.
   */
  mode?: ConsoleMode;
  onResult: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
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
              disabled={isHandledAutomatically('complete', mode)}
              title={
                isHandledAutomatically('complete', mode)
                  ? automatedReason('complete')
                  : undefined
              }
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

      {settled && (
        <div className="rounded-xl border border-border/60 bg-background/40 p-2.5">
          <label
            htmlFor={`feedback-${mission.id}`}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            Leave a note for the learner
          </label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {/* This queue reads mission documents and feedback lives on the
                run, so we cannot say whether one already exists without a
                second read per row. Sending again replaces it either way. */}
            They read this on their mission page. &quot;Good job!&quot;, or what to
            change next time. Sending again replaces an earlier note.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={`feedback-${mission.id}`}
              type="text"
              maxLength={280}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Nice square! Try 90 degrees to close it exactly."
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <ActionButton
              label="Send"
              busy={pending === 'feedback'}
              disabled={feedback.trim().length === 0}
              onClick={() =>
                run('feedback', 'feedback', { text: feedback.trim() }).then(() => setFeedback(''))
              }
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {280 - feedback.length} characters left. Your name is shown with it.
          </p>
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
      // Says where it went. Completing takes a mission out of the queue, and
      // the next job is usually its recording, so naming the filter that now
      // holds it saves hunting for it. It also stays open in the pane beside
      // this message, which is where the video actually gets attached.
      return `Marked ${mission} complete. It is under Needs video until you attach one.`;
    case 'cancel':
      return `Cancelled ${mission}. The record is kept.`;
    case 'resolve':
      return `Resolved the review on ${mission}.`;
    case 'feedback':
      return `Sent your note on ${mission}. The learner sees it on their mission page.`;
  }
}

function ActionButton({
  icon,
  label,
  busy,
  disabled,
  danger,
  title,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Why it is disabled, so a greyed control is not a dead end. */
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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
