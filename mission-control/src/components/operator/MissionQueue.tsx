'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Layers, Loader2, Play, Radio, Rocket, SatelliteDish, Video } from 'lucide-react';

import {
  subscribeToMissionRuns,
  subscribeToYardCompleted,
  subscribeToMission,
  subscribeToYardQueue,
  type QueueMission,
} from '@/infrastructure/persistence/operatorQueueService';

import { MissionDetail } from '@/components/operator/MissionDetail';
import { OperatorTabBar } from '@/components/operator/OperatorTabBar';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type { ConsoleMode } from '@/core/domain/services/consoleMode';
import type { Yard } from '@/core/domain/entities/Yard';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { useRegisterSearchFilters, useRegisterSort, useSearch } from '@/contexts/SearchContext';
import { sortMissions } from '@/core/domain/services/missionSort';
import { stillNeedsVideo } from '@/core/domain/services/missionBookkeeping';
import { readConsoleUrl, writeConsoleUrl, YOUTUBE_STUDIO_URL } from '@/lib/yardConsole';

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
/**
 * Filters that read the settled list rather than the live queue.
 *
 * At module scope because it never changes. Declared inside the component it
 * was a fresh array every render, so any effect depending on it re-ran on
 * every render - which is the dependency warning, not a false positive.
 */
const SETTLED_FILTERS = ['done', 'needs-video'];

/** 08:41, in the operator's own clock. Falls back to nothing for a bad date. */
function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The second line of a queue row: what is true of this mission right now.
 *
 * The row used to carry the raw status as a pill on every line, so a queue of
 * twelve said "queued" twelve times and the one thing worth reading - the
 * satellite's reason for flagging a mission - was a tooltip on a chip. The
 * default state is the quiet one; the exceptions get the words.
 */
function rowStatusLine(mission: QueueMission): string {
  if (mission.needsReview) return mission.reviewReason ?? 'Needs review';
  switch (mission.status) {
    case 'processing':
      return 'Running now';
    case 'queued':
      // When it arrived, which is what triage reads: a queue of nineteen
      // saying "Waiting" nineteen times said nothing the position did not.
      return mission.submittedAt ? `Sent ${clockTime(mission.submittedAt)}` : 'Waiting';
    case 'completed':
      return stillNeedsVideo(mission) ? 'Finished · no video attached yet' : 'Finished';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Did not finish';
  }
}

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
  /** The open mission's own document, so it survives leaving a list. */
  const [watched, setWatched] = useState<{ id: string; mission: QueueMission | null } | null>(null);
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
   * Always automatic: the operator uses the automatic dispatch workflow.
   * Manual mode has been removed to simplify the UI.
   */
  const mode: ConsoleMode = 'auto';
  // Read in an effect, not in useState's initialiser: this component renders
  // on the server too, where localStorage does not exist.
  const [consoleUrl, setConsoleUrl] = useState<string>('');
  const [editingConsole, setEditingConsole] = useState(false);
  useEffect(() => setConsoleUrl(readConsoleUrl()), []);
  const [done, setDone] = useState<QueueMission[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { query, activeFilter, sort } = useSearch();
  useRegisterSort();

  // The same control the learner feed uses, for the same reason: an operator
  // at a busy event is looking for one mission among a queue, and asking them
  // to read down a list is the thing search exists to avoid. Registered here
  // so the navbar renders it, exactly as the feed does.
  const counts = useMemo(() => {
    const all = missions ?? [];
    return {
      all: all.length,
      processing: all.filter((m) => m.status === 'processing').length,
      review: all.filter((m) => m.needsReview).length,
      // null, not 0, until the settled list has been fetched: this count lives
      // in a list that is only subscribed to on demand, and rendering the
      // unfetched state as a zero is what made "Done 0" read as an empty yard.
      needsVideo: done === null ? null : done.filter(stillNeedsVideo).length,
    };
  }, [missions, done]);

  useRegisterSearchFilters([
    { key: 'all', label: 'All in queue', shortLabel: 'Queue', count: counts.all, icon: Layers },
    /**
     * "Waiting" used to sit here, counting the queued missions. It was All in
     * queue minus whatever was running, and one rover runs one mission, so the
     * two chips showed the same number essentially always - and "Running now"
     * already surfaces the difference on its own.
     *
     * The slot pays for itself as the operator's real outstanding work: runs
     * that happened and whose recording nobody has attached yet. That was
     * previously only reachable by opening Done and reading down it.
     */
    { key: 'needs-video', label: 'Needs video', shortLabel: 'Video', count: counts.needsVideo, icon: Video },
    { key: 'processing', label: 'Running now', shortLabel: 'Running', count: counts.processing, icon: Rocket },
    { key: 'review', label: 'Needs review', shortLabel: 'Review', count: counts.review, icon: AlertTriangle },
    /**
     * Where attaching a video happens. A mission leaves the queue the moment
     * it is marked complete, which is exactly when the operator goes off to
     * upload the recording, so without a way back to it the attach action
     * would be unreachable.
     *
     * NO COUNT UNTIL IT HAS LOADED. This list is only subscribed to when it is
     * selected or searched, so before then there is nothing to count - and it
     * used to render that as "Done 0", which does not read as "not loaded
     * yet", it reads as "nothing has ever finished here". At a yard with 25
     * finished missions sitting behind the chip, next to "All in queue 16",
     * that is how a console convinces an operator the yard has 16 missions in
     * total. Once loaded the count is still what loaded rather than what
     * exists, because a true total would need a billed aggregate query for a
     * number nobody acts on.
     */
    { key: 'done', label: 'Done', count: done?.length ?? null, icon: CheckCircle2 },
  ]);

  const source = useMemo(
    () => (SETTLED_FILTERS.includes(activeFilter) ? (done ?? []) : (missions ?? [])),
    [activeFilter, done, missions],
  );

  /**
   * The open mission, watched on its own document.
   *
   * Every list here is a window, and a mission leaves its window the moment
   * its status changes. Marking one complete dropped it out of the queue while
   * the operator was still looking at it and blanked the detail pane - right
   * when their next job was attaching the recording, so they had to go and
   * find it again under Done.
   *
   * Not read from the settled list instead: that list is capped and ordered by
   * submission, so a mission submitted this morning and completed now can
   * settle outside the newest 25 and be unreachable there too.
   */
  useEffect(() => {
    // No clearing on the way out: `watched` is only ever read when its id
    // matches the open mission, so a stale entry is already ignored. Clearing
    // it here would be a setState inside an effect and a second render pass
    // for a value nothing reads.
    if (!selectedId) return;

    const id = selectedId;
    return subscribeToMission(
      id,
      (mission) => setWatched(mission ? { id, mission } : { id, mission: null }),
      // A failed watch is not worth emptying the pane over: the lists still
      // have the mission until it moves out of them.
      () => setWatched(null),
    );
  }, [selectedId]);

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

    /**
     * A search looks at everything loaded, not just the selected filter.
     *
     * Searching used to run over `source` alone, so with the default "All in
     * queue" filter selected there was no text that could find a mission which
     * had already finished - it was not in that list to be matched. An
     * operator looking for a mission by name got "no matches" for a mission
     * that was right there under a different chip, which reads as the mission
     * being gone.
     *
     * The two lists hold disjoint statuses, so concatenating them cannot
     * produce a duplicate.
     */
    const searching = q.length > 0;
    const pool = searching ? [...(missions ?? []), ...(done ?? [])] : source;

    const matched = pool.filter((m) => {
      // While searching, the status chips do not also narrow the result: the
      // point of typing a name is to find it wherever it is.
      if (!searching) {
        if (activeFilter === 'review' && !m.needsReview) return false;
        if (activeFilter === 'needs-video' && !stillNeedsVideo(m)) return false;
        if (activeFilter === 'processing' && m.status !== 'processing') return false;
        return true;
      }
      // Name and code, the same two fields the learner feed searches. There is
      // deliberately nothing about the learner to search on - see above.
      return (m.name ?? '').toLowerCase().includes(q) || m.code.toLowerCase().includes(q);
    });

    return sortMissions(matched, sort);
  }, [source, missions, done, query, activeFilter, sort]);

  // Only while the operator is looking at it. Completed missions accumulate
  // forever, so a listener on them is a read bill that grows with the life of
  // the project, and most console sessions never open this view.
  const searching = query.trim().length > 0;

  useEffect(() => {
    // Also while searching: the settled list is what makes a finished mission
    // findable by name, and it cannot be searched if it was never fetched.
    if (!SETTLED_FILTERS.includes(activeFilter) && !searching) return;

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
  }, [yardId, activeFilter, searching]);

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

  /**
   * The yard is empty AND nothing is open.
   *
   * Both halves matter. This used to be `missions.length === 0` alone, and it
   * is an early return, so it threw away the detail pane along with the list:
   * completing the last mission in the queue collapsed the whole console to
   * "Nothing waiting" while the operator was still looking at that mission,
   * right when their next job was attaching its recording.
   *
   * It also has to consider the settled list, or picking Done or Needs video
   * at a yard whose queue happens to be empty would report the yard as empty
   * while holding a list of finished missions to show.
   */
  if (missions.length === 0 && !selectedId && (done?.length ?? 0) === 0) {
    return (
      <>
        <MobileSearch layout="compact" />
        <div className="flex flex-1 items-center justify-center p-8 text-center md:clay md:rounded-3xl md:border md:border-border/60 md:bg-card/60">
          <div className="max-w-sm space-y-2">
            <p className="font-display text-lg font-bold text-foreground">Nothing waiting</p>
            <p className="text-sm text-muted-foreground">
              No missions queued at {yardName}. New submissions
              appear here as learners send them.
            </p>
          </div>
        </div>
        <OperatorTabBar />
      </>
    );
  }

  // Empty until this mission's own runs arrive, never the previous one's.
  const runs = runsFor?.id === selectedId ? runsFor.runs : [];
  /**
   * The live document first, then whichever list happens to hold it.
   *
   * The document is the only source that cannot lose the mission to a status
   * change, so it wins. The lists are the fallback for the moment before the
   * watch has delivered, which keeps the pane from flickering empty on open.
   */
  const selected =
    (watched?.id === selectedId ? watched.mission : null) ??
    [...(missions ?? []), ...(done ?? [])].find((m) => m.id === selectedId) ??
    null;

  return (
    <>
    {/* Below lg the panes take turns, so with a mission open the search field
        and the four filter chips are 150px of controls for a list that is not
        on the screen - on an 812px phone that was most of what the mission
        pane had left. They come back with the queue. MobileSearch is already
        lg:hidden, so this changes nothing on a desktop. */}
    {!selectedId && <MobileSearch layout="compact" />}
    {/* Two panes from lg up. Below that they take turns: a queue stacked above
        a detail pane means scrolling past every mission to reach the one you
        picked, and a tablet is the device an operator actually holds. */}
    {/* Not an even split. The queue is a list of short rows; the mission
        pane holds the code and the blocks, which is the thing anyone is
        actually reading. */}
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
    {/* A card on a laptop, a full-bleed list on a phone. The card's border,
        padding and shadow were 44px of a 390px width spent on framing a list
        whose rows are the only thing anyone is looking at. */}
    <div className={`min-h-0 flex-1 overflow-y-auto md:clay md:rounded-3xl md:border md:border-border/60 md:bg-card/60 md:p-5 ${
      selectedId ? 'hidden lg:block' : ''
    }`}>
      {/* The console runs on the satellite in the room, on a network this app
          cannot reach, so the operator was expected to remember an address and
          type it into a second tab. The button is the door; the address is
          theirs and lives in their browser. */}
      <div className="mb-2 hidden flex-wrap items-center gap-2 md:flex">
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

      {/* The laptop's heading. On a phone the tab bar already names the view
          and carries its count. */}
      <div className="hidden items-center gap-2 md:flex">
        <Radio className="h-4 w-4 animate-pulse text-primary" />
        <h2 className="font-display text-sm font-bold text-foreground">
          {searching
            ? 'Search'
            : activeFilter === 'needs-video'
              ? 'Needs video'
              : activeFilter === 'done'
                ? 'Finished'
                : 'Queue'}{' '}
          <span className="font-sans text-xs font-medium text-muted-foreground">
            {/* While searching, "of 16" would be a lie: the pool is the queue
                AND the settled list, and the match usually comes from outside
                whichever chip is selected. So a search reports what it found,
                not a fraction of a list it did not search. */}
            ({searching
              ? `${visible.length} found`
              : visible.length === source.length
                ? `${source.length}`
                : `${visible.length} of ${source.length}`}
            {' '}at {yardName})
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

      {/* Dividers on a phone, spaced cards from md: a 390px list has no
          margin to give to gaps between rows. */}
      <ol className="mt-1 divide-y divide-border/50 md:mt-3 md:grid md:gap-2 md:divide-y-0">
        {visible.map((mission, index) => {
          const isSelected = selectedId === mission.id;
          const running = mission.status === 'processing';

          return (
            <li key={mission.id}>
              {/* One target per mission. The row used to carry its own Send to
                  Rover and Open buttons, so a mission had two Send to Rover
                  buttons on screen at once, the row's and the mission pane's.
                  Everything done to a mission now happens in the pane, and the
                  chevron is how the row says it opens. A real button, so the
                  queue works from a keyboard too.

                  Two lines, one row. Name on the first, what is true of it on
                  the second, one leading disc and one trailing chevron: the
                  list-item shape both platforms' guidelines arrive at, because
                  four things laid across 390px truncate the only one that
                  matters. 56px tall, which is the whole target. */}
              <button
                type="button"
                onClick={() => setSelectedId(mission.id)}
                aria-current={isSelected ? 'true' : undefined}
                className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 md:rounded-2xl md:border md:px-3.5 md:py-3 ${
                  isSelected
                    ? 'bg-primary/5 md:border-primary/60'
                    : 'hover:bg-background/60 md:border-border/50 md:bg-background/40 md:hover:border-border'
                }`}
              >
                {/* Position in the queue. It is the number a child at the
                    desk is asking about, and while a mission runs the disc
                    spins instead: "running" is the one state the position
                    does not already say. */}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    running ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Running" /> : index + 1}
                </span>

                {/* The mission name is the only handle, and the only one
                    needed: a child says "mine is Rock Lover" and the operator
                    finds that row without learning anything about them. */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {mission.name || 'Untitled mission'}
                  </span>
                  <span
                    className={`block truncate text-xs ${
                      mission.needsReview
                        ? 'font-medium text-amber-600'
                        : running
                          ? 'font-medium text-primary'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {rowStatusLine(mission)}
                  </span>
                </span>

                {mission.needsReview && (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Needs review" />
                )}

                <ChevronRight
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 transition-[transform,color] duration-150 motion-reduce:transition-none ${
                    isSelected ? 'translate-x-0.5 text-primary' : 'text-muted-foreground'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </div>

    <div className={`min-h-0 md:clay md:rounded-3xl md:border md:border-border/60 md:bg-card/60 md:p-5 ${
      selectedId ? '' : 'hidden lg:block'
    }`}>
      {/* Beside the button that caused it. This used to render at the top of
          the queue pane, on the opposite side of the screen from every control
          that raises it, which is a confirmation an operator can look straight
          past. */}
      {flash && (
        <p
          role="status"
          className="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-foreground"
        >
          {flash}
        </p>
      )}

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

    {/* Choosing a view also closes an open mission. Below lg the panes take
        turns, so a tab that only changed the hidden list would look broken. */}
    <OperatorTabBar onSelect={() => setSelectedId(null)} />
    </>
  );
}
