"use client";

import { PYTHON_DRAFT_KEY } from '@/infrastructure/browser/pythonDraft';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Rocket, Star } from 'lucide-react';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import { missionSlug, parseMissionSlug, pickLinkedMission } from '@/core/domain/services/missionSlug';
import { Mission } from '@/core/domain/entities/Mission';
import Link from 'next/link';
import { useMissionTrajectory } from '@/hooks/useMissionTrajectory';
import { useYardLayout } from '@/hooks/useYardLayout';
import type { CommandSource } from '@/lib/roverBlockly';
import { getDiscoveryStatus } from '@/core/domain/services/discoveryStatus';
import { DiscoveryBadge } from '@/components/ui/DiscoveryBadge';
import { useFavorites } from '@/hooks/useFavorites';
import { findYardIn, yardLabelOf, type Yard } from '@/core/domain/entities/Yard';
import { buildRunOptions, type RunOption } from '@/lib/missionRuns';
import { durationLabel } from '@/lib/missionDuration';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { RunFeed, yardShapeStyle } from '@/components/mission/RunFeed';
import { MissionCode } from '@/components/mission/MissionCode';
import { RemixButton } from '@/components/mission/RemixButton';
import { OperatorFeedback } from '@/components/mission/OperatorFeedback';
import { usePhoneLayout } from '@/hooks/useIsPhoneLayout';
import { useMissionLayout } from '@/hooks/useMissionLayout';
import { missionLayoutStyle } from '@/lib/missionLayout';
import { YARD } from '@/lib/rover-physics';
import { MissionState } from '@/core/domain/entities/MissionState';


export default function MissionVideoClient({
  missionId,
  yards,
}: {
  missionId: string;
  yards: Yard[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoRemix = searchParams.get('autoRemix') === 'true';
  const [mission, setMission] = useState<Mission | null>(null);
  // Every yard's attempt, so the feed can show more than the one video the
  // mission document carries. Empty is ordinary - a mission nobody has run.
  const [missionRuns, setMissionRuns] = useState<MissionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { isFavorite, toggleFavorite } = useFavorites();
  // A phone has no room for the code beside the feed, so there it is a bar
  // under the simulation that opens in place. Null on the server; nothing
  // below renders until a mission has loaded, which is after the browser
  // knows.
  const isPhone = usePhoneLayout() ?? false;
  // Whether the learner has opened or closed the phone's code. Until they do
  // it follows what else there is to look at (below).
  const [codeChoice, setCodeChoice] = useState<boolean | null>(null);

  // The simulated run is reproducible from the mission's code, so it is computed
  // on demand rather than stored. Keeps hosting cheap and always in sync.
  // From the blocks where there are blocks, so it knows which block is which.
  // Simulated in the yard it was sent to, the one drawn below.
  const { layout: yardLayout } = useYardLayout(mission?.yardId);
  const simTrajectory = useMissionTrajectory(mission, yardLayout);
  /** What the simulation is running, lit up in the code like the editor. */
  const [runningSource, setRunningSource] = useState<CommandSource | null>(null);
  // How many times the simulation has played to its end. Each one is the
  // moment a learner has something to change, so each one nudges Remix.
  const [simsWatched, setSimsWatched] = useState(0);
  const watchedSim = useCallback(() => setSimsWatched((n) => n + 1), []);

  // The rover's runs. The simulation is not one of them: it is always on the
  // page, first in the feed. See lib/missionRuns for the reasoning.
  const runs = useMemo<RunOption[]>(
    () => buildRunOptions(mission, missionRuns, yards),
    [mission, missionRuns, yards],
  );

  // The measured yard until the configured one arrives, as the simulator draws.
  const yard = yardLayout ?? YARD;
  const yardAspect = yard.widthCm / yard.depthCm;
  const hasVideo = runs.length > 0;
  // One feed beside the code, or three columns where the window has the room
  // (lib/missionLayout). A phone is never asked: its tree is its own.
  const [bodyRef, roomFor] = useMissionLayout({ yardAspect, hasVideo });
  const wide = !isPhone && roomFor.kind === 'wide';

  useEffect(() => {
    const fetchMission = async () => {
      try {
        const repository = browserMissionRepository();
        // The segment is either a full ID (every link shared before
        // missionSlug existed) or name-plus-ID-prefix. Five candidates, not
        // one: enough to tell a shared prefix apart by name.
        const link = parseMissionSlug(missionId);
        const loadedMission = link.kind === 'id'
          ? await repository.findById(link.id)
          : pickLinkedMission(link, await repository.findByIdPrefix(link.prefix, 5));
        if (!loadedMission) {
          setError('Mission not found');
          return;
        }
        setMission(loadedMission);

        // Show the readable link in the address bar, so the one that gets
        // copied and shared is the readable one. replaceState, not a
        // navigation: nothing reloads and Back still leaves the page.
        const slug = missionSlug(loadedMission);
        if (slug !== missionId) {
          window.history.replaceState(window.history.state, '', `/missions/${encodeURIComponent(slug)}${window.location.search}${window.location.hash}`);
        }

        // Runs are a separate read, and a failure here is not a failure to
        // show the mission: the carousel falls back to the video on the mission
        // document, and worst case to the simulation alone.
        try {
          setMissionRuns(await repository.findRuns(loadedMission.id));
        } catch (runError) {
          console.warn('Could not load runs for this mission:', runError);
        }
      } catch (err) {
        console.error('Fetch mission error:', err);
        setError('Failed to load mission');
      } finally {
        setLoading(false);
      }
    };
    void fetchMission();
  }, [missionId]);

  // Remix into the workspace: carry blocks for block-built missions,
  // otherwise the Python, and open the matching editor mode.
  const remix = useCallback(() => {
    if (mission && MissionState.of(mission.status).isCompleted()) {
      if (mission.blocklyState) {
        localStorage.setItem('roverWorkspace', mission.blocklyState);
        router.push('/mission?mode=blockly');
      } else {
        localStorage.setItem(PYTHON_DRAFT_KEY, mission.code);
        router.push('/mission?mode=code');
      }
    }
  }, [mission, router]);

  // Auto-remix when landing from email or deep link with ?autoRemix=true
  useEffect(() => {
    if (autoRemix && mission && MissionState.of(mission.status).isCompleted()) {
      remix();
    }
  }, [autoRemix, mission, remix]);

  if (loading) {
    return (
      <main className="flex h-page items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
      </main>
    );
  }

  if (error || !mission) {
    return (
      <main className="mx-auto flex h-page max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card/60 clay">
          <Rocket className="h-8 w-8 text-primary" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold text-foreground">Mission not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error || 'We could not load this mission.'}</p>
        <Link
          href="/"
          className="clay clay-press mt-6 rounded-2xl bg-gradient-mars px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
        >
          Back to the feed
        </Link>
      </main>
    );
  }

  const missionName = mission.name || `Mission ${mission.id.slice(0, 8)}`;
  const starred = isFavorite(mission.id);
  const discoveryStatus = getDiscoveryStatus(mission.status);
  const remixable = MissionState.of(mission.status).isCompleted();
  // How long the program runs, which is what the simulation plays. Each
  // rover's video says what its own run took (RunFeed).
  const simDuration = durationLabel(simTrajectory);
  const dateLabel = new Date(mission.completedAt || mission.submittedAt).toLocaleDateString();
  // Closed while there are videos to find under the simulation, since the
  // code open is what folds them away. With no video there is nothing under
  // it to find, and the code is the other half of the screen as it always was.
  const codeOpen = codeChoice ?? !hasVideo;
  // What comes after watching: what the operator wrote back, and Remix. "How
  // did it go?" was a banner of its own above the player, with Remix at the
  // far end of the row above that; the note's slot carries the prompt now,
  // until an operator's note takes its place (OperatorFeedback). Where the
  // two go depends on the screen, below.
  const remixButton = remixable && <RemixButton onRemix={remix} nudge={simsWatched} compact tourId="tour-remix" />;
  const debrief = (
    <>
      <OperatorFeedback runs={missionRuns} ask={remixable} />
      {remixButton}
    </>
  );
  // Three columns, one video: the video is all in view and what is left of
  // its column under it would be empty, so the note takes it, as a card with
  // Remix inside ("a tonne of whitespace at the bottom of the video, that's
  // where the comment should go", 13 October 2026). With more than one video
  // that column is a list and every pixel of it is a video's, so the two stay
  // in the code's card ("in the code part to make space for the videos", the
  // same day).
  const noteUnderTheVideo = wide && runs.length === 1;

  return (
    // Pinned to the viewport at every size, like Create Mission. On a
    // phone this used to stack the panels and scroll the whole page, with the
    // tab bar and the floating button on top of the blocks. Now the one thing
    // that scrolls is the feed of pictures (.missionBody in globals.css), and
    // on a phone the note and Remix stay put under it.
    <main data-surface="mission" className="h-page overflow-hidden px-3 py-2">
      <div className="mx-auto flex h-full min-h-0 max-w-page flex-col gap-2">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          {/* The name is the one thing here that is allowed to shrink, so it
              was the one thing that did: on an iPhone the badge, star and
              Remix took the row and left the title nothing. It keeps room for
              about ten letters now, and the badge and star tighten on a phone
              to make that room. */}
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-2.5">
            <Link href="/" className="shrink-0 text-muted-foreground transition-colors hover:text-primary" aria-label="Back to the feed">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="min-w-[6.5rem] truncate font-display text-base font-bold text-foreground md:min-w-0 md:text-xl">
              {missionName}
            </h1>
            <DiscoveryBadge
              status={discoveryStatus}
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold md:px-2.5 md:py-1 md:uppercase md:tracking-[0.12em]"
            />
            <button
              onClick={() => toggleFavorite(mission.id, missionName)}
              aria-label={starred ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={starred}
              className="-mx-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-amber-400 md:mx-0 md:p-1.5"
            >
              <Star
                className={`h-5 w-5 transition-colors ${starred ? 'fill-amber-400 text-amber-400' : ''}`}
              />
            </button>
            {/* Where it ran, in words. This printed the raw yardId - a child
                reading their own mission page saw "uct-rover-1", which is an
                internal key and means nothing to them. An unrecognised yard
                shows nothing rather than falling back to the id. */}
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {(() => {
                const yard = findYardIn(yards, mission.yardId);
                return yard ? `${yardLabelOf(yard)} · ` : '';
              })()}
              {dateLabel}
            </span>
          </div>
        </div>

        {/* The feed of everything there is to watch, and the code.

            This was two halves, a player and the code, and the player showed
            one thing at a time: the rover's video, with the simulation behind
            an arrow. David could not find the simulation (10 October 2026).
            The feed shows all of it; RunFeed has the rest of the story. */}
        <div
          ref={bodyRef}
          className="missionBody"
          data-alone={hasVideo ? undefined : ''}
          data-layout={wide ? 'wide' : undefined}
          style={{ ...yardShapeStyle(yardAspect), ...(wide ? missionLayoutStyle(roomFor) : {}) }}
        >
          <RunFeed
            runs={runs}
            missionName={missionName}
            trajectory={simTrajectory}
            simDuration={simDuration}
            onSimSourceChange={setRunningSource}
            tourId="tour-mission-video"
            onSimFinished={watchedSim}
            yardId={mission.yardId}
            codeOpen={isPhone && codeOpen}
            videosFoot={
              noteUnderTheVideo ? (
                <OperatorFeedback runs={missionRuns} ask={remixable} roomy>
                  {remixButton}
                </OperatorFeedback>
              ) : undefined
            }
            codeSlot={
              isPhone ? (
                <MissionCode
                  mission={mission}
                  highlight={runningSource}
                  collapsible
                  open={codeOpen}
                  onToggle={() => setCodeChoice(!codeOpen)}
                  tourId="tour-mission-code"
                />
              ) : null
            }
          />
          {/* Beside the feed, or beside the videos' column, the note and
              Remix are the foot of the code's card (MissionCode). Under the
              one video of three columns, the code has its whole card. */}
          {!isPhone && (
            <MissionCode
              mission={mission}
              highlight={runningSource}
              footer={noteUnderTheVideo ? undefined : debrief}
              tourId="tour-mission-code"
            />
          )}
        </div>

        {/* A phone's code is a bar in the feed that is closed more often than
            not, so there the two are a bar of their own that does not move,
            at the bottom, where a thumb already is. */}
        {isPhone && <div className="flex shrink-0 items-center gap-2">{debrief}</div>}
      </div>
    </main>
  );
}
