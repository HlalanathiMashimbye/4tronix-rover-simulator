'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Blocks,
  Check,
  Code2,
  Copy,
  Hourglass,
  Loader2,
  Play,
  Radio,
  Rocket,
  SatelliteDish,
  Layers,
  CheckCircle2,
} from 'lucide-react';

import {
  subscribeToMissionRuns,
  subscribeToYardCompleted,
  subscribeToYardQueue,
  type QueueMission,
} from '@/infrastructure/persistence/operatorQueueService';

import { MissionDetail } from '@/components/operator/MissionDetail';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type { ConsoleMode } from '@/core/domain/services/consoleMode';
import type { Yard } from '@/core/domain/entities/Yard';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { useRegisterSearchFilters, useSearch } from '@/contexts/SearchContext';
import { missionClipboardText } from '@/lib/missionClipboard';
import { readConsoleUrl, writeConsoleUrl } from '@/lib/yardConsole';

/**
 * Where the operator uploads the run video.
 *
 * Not configurable, unlike the yard console: Studio is the same address for
 * everyone, and the channel it opens is whichever the operator is signed into.
 * The run station links here too, at the end of its upload step - this is the
 * same door from the other side, for an operator who is in Mission Control
 * when they realise they still have a video to put up.
 */
const YOUTUBE_STUDIO_URL = 'https://studio.youtube.com/';

/**
 * YouTube's red, one shade off the brand value.
 *
 * #FF0000 against white text is 4.0:1, under the 4.5:1 AA needs at this size.
 * #E60000 is 4.8:1 and indistinguishable from it at a glance, so the button
 * reads as YouTube without being unreadable to anyone who needs the contrast.
 * A literal rather than a token on purpose: this is a third party's brand
 * colour, not a semantic role in our palette, and it must not start meaning
 * "danger" to the next person who reaches for a red.
 */
const YOUTUBE_RED = '#E60000';

/**
 * The live queue for the yard this operator SIGNED IN AT (AB#375/376/377).
 *
 * The yard comes from the session, chosen at sign-in, so it cannot change
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
export function MissionQueue({
  role,
  yardId,
  yardName,
  yards,
}: {
  role: 'operator' | 'admin';
  yardId: string;
  yardName: string;
  yards: Yard[];
}) {
  // Still keyed by yard. It cannot change without a sign-out now, but the key
  // costs nothing and keeps the guarantee: no window where one yard's queue is
  // on screen under another's heading.
  return (
    <YardQueue key={yardId} yardId={yardId} yardName={yardName} role={role} yards={yards} />
  );
}

function YardQueue({
  yardId,
  yardName,
  role,
  yards,
}: {
  yardId: string;
  yardName: string;
  role: 'operator' | 'admin';
  yards: Yard[];
}) {
  const [missions, setMissions] = useState<QueueMission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which mission the detail pane is showing. Replaces the accordion: the
  // code used to push every other mission off the screen to be read.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * WHICH mission the runs belong to, not just the runs.
   *
   * Deriving from that is what lets the effect subscribe and nothing else:
   * clearing the previous mission's runs synchronously inside it is a
   * cascading render, and leaving them uncleared shows one mission's runs
   * under another's name, which reads as it having run somewhere it has not.
   */
  const [runsFor, setRunsFor] = useState<{ id: string; runs: MissionRun[] } | null>(null);
  /**
   * Manual until something is actually doing this work. It will be derived
   * from whether the yard's satellite is online and syncing, because that is
   * what decides whether the automatic path can run at all; the switch is a
   * stand-in for that signal, not a setting anybody should want to keep.
   */
  const [mode, setMode] = useState<ConsoleMode>('manual');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Read in an effect, not in useState's initialiser: this component renders
  // on the server too, where localStorage does not exist.
  const [consoleUrl, setConsoleUrl] = useState<string>('');
  const [editingConsole, setEditingConsole] = useState(false);
  useEffect(() => setConsoleUrl(readConsoleUrl()), []);
  const [done, setDone] = useState<QueueMission[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function copyCode(mission: QueueMission) {
    // Shared with the mission page, so both Copy buttons put the same thing on
    // the clipboard and the run station gets the same paste either way.
    const envelope = missionClipboardText(mission);
    try {
      await navigator.clipboard.writeText(envelope);
      setCopiedId(mission.id);
      // Long enough to read, short enough that the next copy is unambiguous.
      window.setTimeout(() => setCopiedId((id) => (id === mission.id ? null : id)), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // Say so rather than showing "Copied" over an empty clipboard, which
      // would send an operator to paste nothing into the yard.
      window.prompt('Copy this, then paste it into the yard code editor:', envelope);
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

  useEffect(() => {
    if (!selectedId) return;

    const id = selectedId;
    return subscribeToMissionRuns(
      id,
      (next) => setRunsFor({ id, runs: next }),
      // A mission with no runs subcollection is ordinary, not an error worth
      // showing: the operator is looking at the code, not the runs.
      () => setRunsFor({ id, runs: [] }),
    );
  }, [selectedId]);

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
              No missions queued at {yardName}. New submissions
              appear here as learners send them.
            </p>
          </div>
        </div>
      </>
    );
  }

  // Empty until this mission's own runs arrive, never the previous one's.
  const runs = runsFor?.id === selectedId ? runsFor.runs : [];
  const selected = [...(missions ?? []), ...(done ?? [])].find((m) => m.id === selectedId) ?? null;

  return (
    <>
    <MobileSearch />
    {/* Two panes from lg up. Below that they take turns: a queue stacked above
        a detail pane means scrolling past every mission to reach the one you
        picked, and a tablet is the device an operator actually holds. */}
    {/* Not an even split. The queue is a list of short rows; the mission
        pane holds the code and the blocks, which is the thing anyone is
        actually reading. */}
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
    <div className={`clay min-h-0 flex-1 overflow-y-auto rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5 ${
      selectedId ? 'hidden lg:block' : ''
    }`}>
      {flash && (
        <p
          role="status"
          className="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-foreground"
        >
          {flash}
        </p>
      )}

      {/* The console runs on the satellite in the room, on a network this app
          cannot reach, so the operator was expected to remember an address and
          type it into a second tab. The button is the door; the address is
          theirs and lives in their browser. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {editingConsole ? (
          <>
            <input
              type="text"
              defaultValue={consoleUrl}
              aria-label="Yard console address"
              placeholder="mro.local:3001/run/"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setConsoleUrl(writeConsoleUrl(e.currentTarget.value));
                  setEditingConsole(false);
                }
                if (e.key === 'Escape') setEditingConsole(false);
              }}
            />
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setEditingConsole(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <a
              href={consoleUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-mars px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              <SatelliteDish className="h-3.5 w-3.5" aria-hidden="true" />
              Open operator console
            </a>
            <button
              type="button"
              className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => setEditingConsole(true)}
            >
              Change
            </button>
            {/* Informational only, and the first thing to go when the row is tight:
                the button works without anyone reading the address. Hiding it
                below 2xl keeps this toolbar on one line, and a second line here
                comes out of the queue below it. */}
            <span className="hidden truncate font-mono text-[11px] text-muted-foreground 2xl:inline">{consoleUrl}</span>
          </>
        )}

        {/* Outside the branch above, so editing the console address does not
            make the other door disappear. */}
        <a
          href={YOUTUBE_STUDIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ backgroundColor: YOUTUBE_RED }}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          YouTube Studio
        </a>
      </div>

      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 animate-pulse text-primary" />
        <h2 className="font-display text-sm font-bold text-foreground">
          {activeFilter === 'done' ? 'Finished' : 'Queue'}{' '}
          <span className="font-sans text-xs font-medium text-muted-foreground">
            ({visible.length === source.length
              ? `${source.length} at ${yardName}`
              : `${visible.length} of ${source.length} at ${yardName}`})
          </span>
        </h2>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Bookkeeping
        </span>
        {/* A switch rather than a hidden capability, so an operator can see
            what the platform is doing for them and take it back when the yard
            is offline and it plainly is not. */}
        <span className="inline-flex rounded-lg border border-border/60 bg-background/60 p-px text-[11px] font-semibold">
          {(['manual', 'auto'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMode(option)}
              aria-pressed={mode === option}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                mode === option
                  ? 'bg-gradient-mars text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option === 'manual' ? 'I do it' : 'Automatic'}
            </button>
          ))}
        </span>
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
          const isSelected = selectedId === mission.id;

          return (
            <li
              key={mission.id}
              onClick={() => setSelectedId(mission.id)}
              className={`cursor-pointer rounded-2xl border px-3.5 py-3 transition-colors ${
                isSelected
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-border/50 bg-background/40 hover:border-border'
              }`}
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
                  onClick={() => setSelectedId(mission.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/70"
                >
                  {mission.blocklyState ? (
                    <Blocks className="h-3 w-3" />
                  ) : (
                    <Code2 className="h-3 w-3" />
                  )}
                  Open
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>

    <div className={`clay min-h-0 rounded-3xl border border-border/60 bg-card/60 p-4 sm:p-5 ${
      selectedId ? '' : 'hidden lg:block'
    }`}>
      <MissionDetail
        mission={selected}
        runs={runs}
        yards={yards}
        yardId={yardId}
        isAdmin={role === 'admin'}
        mode={mode}
        onBack={() => setSelectedId(null)}
        onResult={(message) => {
          setFlash(message);
          window.setTimeout(() => setFlash((f) => (f === message ? null : f)), 4000);
        }}
      />
    </div>
    </div>
    </>
  );
}
