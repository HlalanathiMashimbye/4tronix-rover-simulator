'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Blocks, Code2, Loader2, Radio, User } from 'lucide-react';

import {
  subscribeToYardQueue,
  type QueueMission,
} from '@/lib/services/operatorQueueService';
import type { LearnerProfile } from '@/app/api/operator/learners/route';
import {
  readStoredYard,
  serverYardSnapshot,
  subscribeToYard,
  yardLabel,
} from '@/infrastructure/config/yards';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';

/**
 * The live queue for the yard this operator has selected (AB#375/376/377).
 *
 * The yard comes from the same store YardPicker writes, so changing the picker
 * tears this subscription down and opens one against the new yard. That is the
 * whole reason the yard is a runtime selection rather than a claim.
 */
export function MissionQueue() {
  const yardId = useSyncExternalStore(subscribeToYard, readStoredYard, serverYardSnapshot);

  // Keyed by yard, so switching yards REMOUNTS rather than resetting state
  // inside an effect. React's own answer to "reset all state when a prop
  // changes", and it means there is no window where the previous yard's queue
  // is on screen under the new yard's heading.
  return <YardQueue key={yardId} yardId={yardId} />;
}

function YardQueue({ yardId }: { yardId: string }) {
  const [missions, setMissions] = useState<QueueMission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, LearnerProfile>>({});

  // Refs already asked about, including ones that resolved to nothing. Held in
  // a ref rather than derived from `profiles` so the snapshot callback cannot
  // see a stale copy, and so resolving cannot feed back into a re-render that
  // triggers another resolve.
  const askedRefs = useRef<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const resolveProfiles = useCallback(async (refs: string[]) => {
    try {
      const response = await fetch('/api/operator/learners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs }),
      });
      const data = await response.json();
      if (!data.success || !data.profiles) return;

      // Record a blank for anything that resolved to nothing, so it is not
      // asked for again on the next snapshot.
      const merged: Record<string, LearnerProfile> = {};
      for (const ref of refs) merged[ref] = data.profiles[ref] ?? {};
      setProfiles((prev) => ({ ...prev, ...merged }));
    } catch {
      // Identity is a nicety. A queue that cannot name anyone is still a queue.
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToYardQueue(
      yardId,
      (next) => {
        setMissions(next);
        setError(null);

        const unknown = [
          ...new Set(next.map((m) => m.learnerRef).filter((r): r is string => !!r)),
        ].filter((ref) => !askedRefs.current.has(ref));

        if (unknown.length) {
          unknown.forEach((ref) => askedRefs.current.add(ref));
          resolveProfiles(unknown);
        }
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
  }, [yardId, resolveProfiles]);

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
      <div className="clay flex flex-1 items-center justify-center rounded-3xl border border-border/60 bg-card/60 p-8 text-center">
        <div className="max-w-sm space-y-2">
          <p className="font-display text-lg font-bold text-foreground">Nothing waiting</p>
          <p className="text-sm text-muted-foreground">
            No missions queued at {yardLabel(yardId) ?? 'this yard'}. New submissions
            appear here as learners send them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="clay min-h-0 flex-1 overflow-y-auto rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 animate-pulse text-primary" />
        <h2 className="font-display text-sm font-bold text-foreground">
          Queue{' '}
          <span className="font-sans text-xs font-medium text-muted-foreground">
            ({missions.length} at {yardLabel(yardId) ?? yardId})
          </span>
        </h2>
      </div>

      <ol className="mt-3 grid gap-2">
        {missions.map((mission, index) => {
          const profile = mission.learnerRef ? profiles[mission.learnerRef] : undefined;
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

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {mission.name || 'Untitled mission'}
                  </p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {/* HOW LITTLE THIS CAN SAY, AND WHY.
                        The avatar colour is what the learner sees on their own
                        screen, so it is the only shared token between a queue
                        row and a child in the room. It is weak: 7 colours
                        across 170 learners. displayName would be the real
                        answer, and every learner record has none, because
                        updateDisplayName exists in LearnerContext and no UI
                        calls it. missionCount is 0 on every record for the
                        same kind of reason: nothing increments it. Both are
                        read here so this lights up the day either is filled,
                        rather than needing this component changed. */}
                    {profile?.avatarColor && (
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border"
                        style={{ backgroundColor: profile.avatarColor }}
                      />
                    )}
                    <User className="h-3 w-3 shrink-0" />
                    {profile?.displayName ??
                      (profile?.missionCount
                        ? `mission ${profile.missionCount} for this learner`
                        : 'a learner')}
                  </p>
                </div>

                {mission.needsReview && (
                  <span
                    title={mission.reviewReason ?? 'Flagged for review'}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    review
                  </span>
                )}

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
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
