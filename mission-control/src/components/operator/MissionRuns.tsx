'use client';

import { useState } from 'react';
import { ClipboardList, Loader2, MapPin, Play, Plus, Trash2, Video } from 'lucide-react';

import { yardLabelOf, findYardIn, type Yard } from '@/core/domain/entities/Yard';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type { ConsoleMode } from '@/core/domain/services/consoleMode';
import { isHandledAutomatically, automatedReason } from '@/core/domain/services/consoleMode';

/**
 * Every attempt at this mission, and the video belonging to each.
 *
 * ONE PLACE FOR ONE JOB. Managing recordings used to be spread across three
 * unrelated blocks: a read-only list of runs, a separate card for attaching a
 * video, and a third for logging another run. None of them said which video
 * belonged to which attempt, because the video was attached to the mission
 * rather than to a run - so a mission run twice had two recordings and one
 * slot, and no way to tell them apart or take the wrong one back off.
 *
 * A run owns its video here. Replacing, removing and deleting all sit on the
 * row they act on, so the thing being changed is the thing under the cursor
 * rather than a form further down the pane.
 *
 * Only this operator's own yard's runs are editable. The others are shown
 * because a mission is not yard-scoped even though the queue is, and knowing
 * Durban already ran it is the difference between running it again and leaving
 * it alone - but acting on them is refused by the API regardless.
 */
export function MissionRuns({
  missionId,
  runs,
  yards,
  yardId,
  // Defaulted, not optional at the call site: the same default MissionActions
  // uses, so the two cannot disagree about what an unset mode means.
  mode = 'manual',
  onResult,
}: {
  missionId: string;
  runs: MissionRun[];
  yards: Yard[];
  yardId: string;
  mode?: ConsoleMode;
  onResult: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // In auto, completion and linking videos normally happen by themselves. The
  // run controls still show: a wrong link, a run logged twice, or a video the
  // linker never found are exceptions, and hiding the controls left an
  // operator with no way to fix any of them.
  const automated = isHandledAutomatically('attach-video', mode);
  const mine = runs.filter((r) => r.yardId === yardId);

  async function send(
    action: string,
    key: string,
    body: Record<string, unknown>,
    success: string,
  ) {
    setPending(key);
    setError(null);
    try {
      const response = await fetch(`/api/operator/missions/${missionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yardId, ...body, action }),
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        setError(payload.error ?? 'That did not work. Try again.');
        return;
      }
      // The runs list is a live subscription, so the row updates itself; this
      // only has to say what happened.
      onResult(success);
      setEditing(null);
      setUrl('');
      setConfirmingDelete(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPending(null);
    }
  }

  return (
    // MISSION STATUS, not a list of runs: this card is where an operator
    // finds out whether a mission is done and has its video, so it carries
    // the weight of a heading and its one common job, adding the video, is a
    // real button rather than a word in grey.
    <section className="shrink-0 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] via-background/60 to-background/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
            <ClipboardList className="h-4.5 w-4.5 text-primary" />
          </span>
          <div>
            <h3 className="font-display text-base font-bold text-foreground">Mission status</h3>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {runs.length === 0
                ? 'No runs yet'
                : runs.length === 1
                  ? 'One run'
                  : `${runs.length} runs`}
            </p>
          </div>
        </div>

        {/* The yard keeps a recording per attempt, so the platform needs a run
            per attempt for them to attach to. */}
        <button
          type="button"
          onClick={() => send('another-run', 'another-run', {}, 'Logged another run.')}
          disabled={pending !== null}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === 'another-run' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Log another run
        </button>
      </div>

      {mine.length === 0 && runs.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing has run yet. Once a mission has been driven at this yard, log the
          run here so its recording has somewhere to go.
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {runs.map((run) => {
          const yard = findYardIn(yards, run.yardId);
          const ours = run.yardId === yardId;
          const busy = pending === run.runId;

          return (
            <li
              key={run.runId}
              className="rounded-xl border border-border/50 bg-background/80 px-3 py-2.5 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
                <span className={ours ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                  {yard ? yardLabelOf(yard) : run.yardId}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RUN_STATUS_CLASS[run.status] ?? RUN_STATUS_CLASS.queued}`}>
                  {RUN_STATUS_LABEL[run.status] ?? run.status}
                </span>

                {run.youtubeUrl ? (
                  <a
                    href={run.youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-[#E60000]/10 px-2 py-1 text-xs font-semibold text-[#E60000] hover:bg-[#E60000]/15"
                  >
                    <Play className="h-3 w-3" />
                    Watch
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">No video yet</span>
                )}

                {ours && (
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(editing === run.runId ? null : run.runId);
                        setUrl(run.youtubeUrl ?? '');
                      }}
                      title={automated && !run.youtubeUrl ? automatedReason('attach-video') : undefined}
                      className={run.youtubeUrl
                        ? 'rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground'
                        : 'inline-flex items-center gap-1.5 rounded-lg bg-[#E60000] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#cc0000]'}
                    >
                      {!run.youtubeUrl && <Video className="h-3.5 w-3.5" />}
                      {run.youtubeUrl ? 'Replace' : 'Add video'}
                    </button>

                    {run.youtubeUrl && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          send('remove-video', run.runId, { runId: run.runId }, 'Video removed.')
                        }
                        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Remove video
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Delete this run at ${yard ? yardLabelOf(yard) : run.yardId}`}
                      onClick={() =>
                        confirmingDelete === run.runId
                          ? send('delete-run', run.runId, { runId: run.runId }, 'Run deleted.')
                          : setConfirmingDelete(run.runId)
                      }
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                        confirmingDelete === run.runId
                          ? 'bg-destructive/10 text-destructive'
                          : 'text-muted-foreground hover:text-destructive'
                      }`}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {confirmingDelete === run.runId ? 'Sure?' : ''}
                    </button>
                  </span>
                )}
              </div>

              {editing === run.runId && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="url"
                    inputMode="url"
                    autoFocus
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://youtu.be/..."
                    aria-label="YouTube link for this run"
                    className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  <button
                    type="button"
                    disabled={url.trim().length === 0 || busy}
                    onClick={() =>
                      send(
                        'attach-video',
                        run.runId,
                        { runId: run.runId, url: url.trim() },
                        'Video attached to this run.',
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-[11px] font-medium text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/** A run's state at a glance. Operator-facing, so "failed" can be said here. */
const RUN_STATUS_LABEL: Record<string, string> = {
  queued: 'Waiting',
  processing: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const RUN_STATUS_CLASS: Record<string, string> = {
  queued: 'bg-amber-500/15 text-amber-700',
  processing: 'bg-sky-500/15 text-sky-700',
  completed: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};
