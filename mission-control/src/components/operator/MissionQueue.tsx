'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Blocks,
  Check,
  Code2,
  Copy,
  Hourglass,
  Loader2,
  Radio,
  Rocket,
  Layers,
  CheckCircle2,
} from 'lucide-react';

import {
  subscribeToYardCompleted,
  subscribeToYardQueue,
  type QueueMission,
} from '@/lib/services/operatorQueueService';
import {
  readStoredYard,
  serverYardSnapshot,
  subscribeToYard,
  yardLabel,
} from '@/infrastructure/config/yards';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
import { MissionActions } from '@/components/operator/MissionActions';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { useRegisterSearchFilters, useSearch } from '@/contexts/SearchContext';

/**
 * The live queue for the yard this operator has selected (AB#375/376/377).
 *
 * The yard comes from the same store YardPicker writes, so changing the picker
 * tears this subscription down and opens one against the new yard. That is the
 * whole reason the yard is a runtime selection rather than a claim.
 *
 * NOTHING HERE IDENTIFIES THE LEARNER, ON PURPOSE.
 *
 * AB#377 asked for "who submitted each mission". That was written against the
 * grain of the entire platform: learners are not Firebase Auth users, missions
 * carry `learnerRef` (a one-way hash) rather than an id, email addresses are
 * hashed and kept in a subcollection browsers cannot reach, and no learner has
 * a display name because nothing offers to set one. Those are not gaps to fill.
 * They are the anonymity model the project has held to since the beginning, and
 * a queue screen that may be facing a room of children is the last place to
 * start eroding it.
 *
 * A build of this did briefly exist, with an operator-only route joining
 * learnerRef back to a learner record. It is deleted. The mission NAME is the
 * handle: a child says "mine is Rock Lover" and the operator finds that row.
 * That works without anyone knowing whose it is.
 */
export function MissionQueue({ role }: { role: 'operator' | 'admin' }) {
  const yardId = useSyncExternalStore(subscribeToYard, readStoredYard, serverYardSnapshot);

  // Keyed by yard, so switching yards REMOUNTS rather than resetting state
  // inside an effect. React's own answer to "reset all state when a prop
  // changes", and it means there is no window where the previous yard's queue
  // is on screen under the new yard's heading.
  return <YardQueue key={yardId} yardId={yardId} role={role} />;
}

function YardQueue({ yardId, role }: { yardId: string; role: 'operator' | 'admin' }) {
  const [missions, setMissions] = useState<QueueMission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [done, setDone] = useState<QueueMission[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function copyCode(mission: QueueMission) {
    try {
      await navigator.clipboard.writeText(mission.code);
      setCopiedId(mission.id);
      // Long enough to read, short enough that the next copy is unambiguous.
      window.setTimeout(() => setCopiedId((id) => (id === mission.id ? null : id)), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // Say so rather than showing "Copied" over an empty clipboard, which
      // would send an operator to paste nothing into the yard.
      window.prompt('Copy this, then paste it into the yard code editor:', mission.code);
    }
  }

  const { query, activeFilter } = useSearch();

  // The same control the learner feed uses, for the same reason: an operator
  // at a busy event is looking for one mission among a queue, and asking them
  // to read down a list is the thing search exists to avoid. Registered here
  // so the navbar renders it, exactly as the feed does.
  const counts = useMemo(() => {
    const all = missions ?? [];
    return {
      all: all.length,
      queued: all.filter((m) => m.status === 'queued').length,
      processing: all.filter((m) => m.status === 'processing').length,
      review: all.filter((m) => m.needsReview).length,
    };
  }, [missions]);

  useRegisterSearchFilters([
    { key: 'all', label: 'All in queue', count: counts.all, icon: Layers },
    { key: 'queued', label: 'Waiting', count: counts.queued, icon: Hourglass },
    { key: 'processing', label: 'Running now', count: counts.processing, icon: Rocket },
    { key: 'review', label: 'Needs review', count: counts.review, icon: AlertTriangle },
    // Where attaching a video happens. A mission leaves the queue the moment it
    // is marked complete, which is exactly when the operator goes off to upload
    // the recording, so without a way back to it the attach action would be
    // unreachable. Count is what has loaded rather than what exists: this list
    // is bounded, and a total would need a billed aggregate query for a number
    // nobody acts on.
    { key: 'done', label: 'Done', count: done?.length ?? 0, icon: CheckCircle2 },
  ]);

  const source = useMemo(
    () => (activeFilter === 'done' ? (done ?? []) : (missions ?? [])),
    [activeFilter, done, missions],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((m) => {
      if (activeFilter === 'review' && !m.needsReview) return false;
      if (activeFilter === 'queued' && m.status !== 'queued') return false;
      if (activeFilter === 'processing' && m.status !== 'processing') return false;
      if (!q) return true;
      // Name and code, the same two fields the learner feed searches. There is
      // deliberately nothing about the learner to search on - see above.
      return (m.name ?? '').toLowerCase().includes(q) || m.code.toLowerCase().includes(q);
    });
  }, [source, query, activeFilter]);

  // Only while the operator is looking at it. Completed missions accumulate
  // forever, so a listener on them is a read bill that grows with the life of
  // the project, and most console sessions never open this view.
  useEffect(() => {
    if (activeFilter !== 'done') return;

    const unsubscribe = subscribeToYardCompleted(
      yardId,
      (next) => {
        setDone(next);
        setError(null);
      },
      () => {
        setDone(null);
        setError(
          'Could not load finished missions. If this yard is new, the index for this view may not be deployed yet.',
        );
      },
    );

    // Cleared on the way OUT rather than on the way in. Clearing it in the
    // effect body would be a setState during an effect, which costs a second
    // render pass on every filter change and is what react-hooks flags.
    return () => {
      unsubscribe();
      setDone(null);
    };
  }, [yardId, activeFilter]);

  useEffect(() => {
    const unsubscribe = subscribeToYardQueue(
      yardId,
      (next) => {
        setMissions(next);
        setError(null);
      },
      () => {
        // Never leave a failed listener looking like an empty queue. An
        // operator has to be able to tell "nothing waiting" from "this is
        // broken", because the two call for opposite actions.
        setMissions(null);
        setError('The live queue lost its connection. Missions may still be running at the yard.');
      },
    );

    return unsubscribe;
  }, [yardId]);

  if (error) {
    return (
      <div
        role="alert"
        className="clay flex flex-1 items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/5 p-8 text-center"
      >
        <div className="max-w-sm space-y-2">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="font-display text-lg font-bold text-foreground">Queue disconnected</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (missions === null) {
    return (
      <div className="clay flex flex-1 items-center justify-center rounded-3xl border border-border/60 bg-card/60 p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (missions.length === 0) {
    return (
      <>
        <MobileSearch />
        <div className="clay flex flex-1 items-center justify-center rounded-3xl border border-border/60 bg-card/60 p-8 text-center">
          <div className="max-w-sm space-y-2">
            <p className="font-display text-lg font-bold text-foreground">Nothing waiting</p>
            <p className="text-sm text-muted-foreground">
              No missions queued at {yardLabel(yardId) ?? 'this yard'}. New submissions
              appear here as learners send them.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    <MobileSearch />
    <div className="clay min-h-0 flex-1 overflow-y-auto rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5">
      {flash && (
        <p
          role="status"
          className="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-foreground"
        >
          {flash}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 animate-pulse text-primary" />
        <h2 className="font-display text-sm font-bold text-foreground">
          {activeFilter === 'done' ? 'Finished' : 'Queue'}{' '}
          <span className="font-sans text-xs font-medium text-muted-foreground">
            ({visible.length === source.length
              ? `${source.length} at ${yardLabel(yardId) ?? yardId}`
              : `${visible.length} of ${source.length} at ${yardLabel(yardId) ?? yardId}`})
          </span>
        </h2>
      </div>

      {/* A filter that matches nothing is not an empty yard, and saying so
          stops an operator concluding the queue broke. */}
      {visible.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No mission in this queue matches that. Clear the search or pick a
          different filter.
        </p>
      )}

      <ol className="mt-3 grid gap-2">
        {visible.map((mission, index) => {
          const isOpen = expanded === mission.id;

          return (
            <li
              key={mission.id}
              className="rounded-2xl border border-border/50 bg-background/40 px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>

                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    mission.status === 'processing'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {mission.status === 'processing' && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  {mission.status}
                </span>

                {/* The mission name is the only handle, and the only one
                    needed: a child says "mine is Rock Lover" and the operator
                    finds that row without learning anything about them. */}
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {mission.name || 'Untitled mission'}
                </p>

                {mission.needsReview && (
                  <span
                    title={mission.reviewReason ?? 'Flagged for review'}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    review
                  </span>
                )}

                {/* The manual bridge to the yard, and deliberately manual.
                    Mission Control cannot reach the satellite: it is behind
                    carrier NAT with no inbound path, which is why Firestore is
                    the only channel between them. So the operator keeps both
                    open in tabs, copies the Python here, and pastes it into
                    the yard's /code/ editor to run.

                    This is a fallback that should survive automated dispatch
                    rather than be replaced by it - it is the path that works
                    when the venue's internet does not. */}
                <button
                  onClick={() => copyCode(mission)}
                  disabled={!mission.code}
                  title="Copy the Python, then paste it into the yard's code editor"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copiedId === mission.id ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copiedId === mission.id ? 'Copied' : 'Copy'}
                </button>

                <button
                  onClick={() => setExpanded(isOpen ? null : mission.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70"
                >
                  {mission.blocklyState ? (
                    <Blocks className="h-3 w-3" />
                  ) : (
                    <Code2 className="h-3 w-3" />
                  )}
                  {isOpen ? 'Hide' : mission.blocklyState ? 'Blocks' : 'Code'}
                </button>
              </div>

              {isOpen && (
                <>
                <div className="mt-3 border-t border-border/50 pt-3">
                  {/* The blocks the learner actually built, which the Flask
                      console structurally cannot show: the satellite's SQLite
                      mirror has no blocklyState column. Falling back to Python
                      for missions typed rather than built. */}
                  {mission.blocklyState ? (
                    <div className="h-64 overflow-hidden rounded-xl border border-border/50">
                      <BlocklyViewer state={mission.blocklyState} />
                    </div>
                  ) : (
                    <pre className="max-h-64 overflow-auto rounded-xl border border-border/50 bg-background/60 p-3 text-xs text-foreground">
                      {mission.code || 'No code on this mission.'}
                    </pre>
                  )}
                </div>
                <MissionActions
                  mission={mission}
                  yardId={yardId}
                  isAdmin={role === 'admin'}
                  onResult={(message) => {
                    setFlash(message);
                    // Collapse it. For complete and cancel the row is about to
                    // leave this view anyway, and leaving a panel open over a
                    // mission that no longer belongs here reads as a bug.
                    setExpanded(null);
                    window.setTimeout(() => setFlash((f) => (f === message ? null : f)), 4000);
                  }}
                />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
    </>
  );
}
