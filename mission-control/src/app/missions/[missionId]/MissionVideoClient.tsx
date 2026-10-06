"use client";

import { PYTHON_DRAFT_KEY } from '@/infrastructure/browser/pythonDraft';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Rocket, Star, Zap, Lightbulb } from 'lucide-react';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import { Mission } from '@/core/domain/entities/Mission';
import Link from 'next/link';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
import { useMissionTrajectory } from '@/hooks/useMissionTrajectory';
import { useYardLayout } from '@/hooks/useYardLayout';
import type { CommandSource } from '@/lib/roverBlockly';
import { getDiscoveryStatus, DISCOVERY_BADGE_CLASS } from '@/core/domain/services/discoveryStatus';
import { useFavorites } from '@/hooks/useFavorites';
import { findYardIn, yardLabelOf, type Yard } from '@/core/domain/entities/Yard';
import { buildRunOptions, type RunOption } from '@/lib/missionRuns';
import { durationLabel } from '@/lib/missionDuration';
import { missionClipboardText } from '@/lib/missionClipboard';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { RunStackCarousel } from '@/components/mission/RunStackCarousel';
import { OperatorFeedback } from '@/components/mission/OperatorFeedback';
import { CodeLines } from '@/components/mission/CodeLines';


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
  // Every yard's attempt, so the carousel can show more than the one video the
  // mission document carries. Empty is ordinary - a mission nobody has run.
  const [missionRuns, setMissionRuns] = useState<MissionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Null until the mission loads, then the first run - which is the real one
  // when there is one. A child opening their mission sees the rover, not a
  // simulation they have already watched in the editor.
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [codeView, setCodeView] = useState<'blocks' | 'python'>('blocks');
  const [copied, setCopied] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();

  // The simulated run is reproducible from the mission's code, so it is computed
  // on demand rather than stored. Keeps hosting cheap and always in sync.
  // From the blocks where there are blocks, so it knows which block is which.
  // Simulated in the yard it was sent to (AB#468), the one drawn below.
  const { layout: yardLayout } = useYardLayout(mission?.yardId);
  const simTrajectory = useMissionTrajectory(mission, yardLayout);
  /** What the simulation is running, lit up in the code like the editor (AB#450). */
  const [runningSource, setRunningSource] = useState<CommandSource | null>(null);

  // Real runs come FIRST, which is the point: a child needs to see that an
  // actual rover drove their code. See lib/missionRuns for the reasoning.
  const runs = useMemo<RunOption[]>(
    () => buildRunOptions(mission, missionRuns, yards),
    [mission, missionRuns, yards],
  );

  useEffect(() => {
    const fetchMission = async () => {
      try {
        const repository = browserMissionRepository();
        const loadedMission = await repository.findById(missionId);
        if (!loadedMission) {
          setError('Mission not found');
          return;
        }
        setMission(loadedMission);

        // Runs are a separate read, and a failure here is not a failure to
        // show the mission: the carousel falls back to the video on the mission
        // document, and worst case to the simulation alone.
        try {
          setMissionRuns(await repository.findRuns(missionId));
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
    if (mission && mission.status === 'completed') {
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
    if (autoRemix && mission && mission.status === 'completed') {
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
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  // Was mission.executionMetadata?.duration_ms - a key no mission document
  // has ever carried, so this always read "Not yet", including under footage
  // of a rover that had clearly finished. See lib/missionDuration.
  const duration = durationLabel(simTrajectory, selectedRun);
  const dateLabel = new Date(mission.completedAt || mission.submittedAt).toLocaleDateString();
  const hasBlocks = !!mission.blocklyState;
  const showBlocks = hasBlocks && codeView === 'blocks';

  const copyCode = async () => {
    // The same payload the operator queue copies. This button used to write
    // bare mission.code, which pasted into the run station as an anonymous
    // block of Python: no name, no id, and so no run id for the recording.
    try {
      await navigator.clipboard.writeText(missionClipboardText(mission));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    // Pinned to the viewport at every size, like Create Mission (AB#455). On a
    // phone this used to stack the panels and scroll, with the tab bar and the
    // floating button on top of the blocks. Now the player docks at the top
    // and the code takes the rest (.workspaceSplitGrid--fixed in globals.css).
    // It once clipped the code entirely under overflow-hidden; the fix then
    // was to let it scroll, the fix now is a layout that fits.
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
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold md:px-2.5 md:py-1 md:uppercase md:tracking-[0.12em] ${DISCOVERY_BADGE_CLASS[discoveryStatus]}`}
            >
              {discoveryStatus}
            </span>
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
          {/* In the header, like Run in the editor: the one thing to do next
              on this page. It was a card under the code, a whole row of a
              phone screen. */}
          {mission.status === 'completed' && (
            <button
              onClick={remix}
              title="Tweak the code and run your own version"
              className="clay clay-press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-mars px-3 py-1.5 font-display text-xs font-bold text-primary-foreground md:text-sm"
            >
              <Zap className="h-3.5 w-3.5" fill="currentColor" />
              {/* Words down to the narrowest phones; below 360px the bolt alone,
                  named for screen readers by aria-label. */}
              <span className="max-[359px]:sr-only">Remix</span>
            </button>
          )}
        </div>

        {mission.status === 'completed' && (
          <div className="flex shrink-0 items-start gap-3 rounded-2xl border-2 border-amber-200/30 bg-gradient-to-br from-amber-50/50 to-orange-50/50 p-4 dark:border-amber-950/40 dark:from-amber-950/30 dark:to-orange-950/30">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="font-display font-semibold text-foreground">
                How did it go?
              </h2>
              <p className="text-sm text-muted-foreground">
                Remix it to go further or fix it.
              </p>
            </div>
          </div>
        )}

        {/* Fixed at 60/40, video to code, and the number came from the
            simulator's geometry rather than taste.

            The yard is letterboxed by computeLayout inside whatever canvas it
            gets, so a WIDER panel makes it worse, not better. Measured for the
            old 4:3 yard, at a 1400px viewport:

              70/30  canvas 799x497 (1.61)  yard floats, 87px dead each side
              65/35  canvas 716x469 (1.53)  64px each side
              60/40  canvas 664x490 (1.35)  24px each side

            The two media want opposite shapes and no split serves both: 16:9
            video wants width, the 4:3 yard wants less of it. 60/40 is chosen
            because the failures are not equivalent. A letterboxed video is
            what every player does and nobody remarks on it; a yard floating in
            grey with a hand's width of nothing down each side reads as a
            rendering fault, which is exactly how it was reported.

            Since AB#464 the yard is the measured one, 233 x 249 cm, near
            square, and it is stretched to fill the canvas (computeLayout), so
            no split leaves bars beside it. The split stays for the video's
            sake.

            The 320px floor on the right track keeps the code readable, so this
            does not squeeze the editor to buy the change.

            No height: the grid is a flexible track and takes what this flex
            column has left, the same as Create Mission. */}
        <div className="workspaceSplitGrid workspaceSplitGrid--fixed">
          <div className="flex min-h-0 flex-col gap-2">
            <RunStackCarousel
              runs={runs}
              selectedId={selectedRun.id}
              onSelect={setSelectedRunId}
              missionName={missionName}
              trajectory={simTrajectory}
              onSimSourceChange={setRunningSource}
              yardId={mission.yardId}
            />
            {/* Under the player, where a learner looks after watching. One
                line, so the leftover height goes to the player instead. */}
            <OperatorFeedback runs={missionRuns} />
          </div>
          {/* Code (scrolls internally) + remix */}
          <div className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60">
            <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
              {hasBlocks ? (
                <div
                  // p-px, not p-0.5: rounded-lg is 14.4 and the buttons are
                  // rounded-md at 12.4, so the track between them has to be 2px
                  // (1px border + 1px padding) for the corners to stay
                  // concentric. At p-0.5 it was a pixel out.
                  className="inline-flex rounded-lg border border-border bg-card p-px text-xs font-semibold"
                >
                  <button
                    onClick={() => setCodeView('blocks')}
                    className={`rounded-md px-3 py-1 transition-colors ${showBlocks ? 'bg-gradient-mars text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Blocks
                  </button>
                  <button
                    onClick={() => setCodeView('python')}
                    className={`rounded-md px-3 py-1 transition-colors ${showBlocks ? 'text-muted-foreground hover:text-foreground' : 'bg-gradient-mars text-primary-foreground'}`}
                  >
                    Python
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-400/70" />
                  <span className="h-2 w-2 rounded-full bg-amber-400/70" />
                  <span className="h-2 w-2 rounded-full bg-green-400/70" />
                  <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    mission.py
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                {/* How long it runs, beside the code that decides it. Status
                    and "built with" are already said by the badge and the
                    Blocks/Python switch. */}
                <span className="font-mono text-[11px] text-muted-foreground" title="How long it runs">
                  {duration}
                </span>
                <button
                  onClick={copyCode}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            {showBlocks ? (
              <div className="min-h-0 flex-1">
                <BlocklyViewer
                  state={mission.blocklyState!}
                  highlight={runningSource}
                  // The whole program, as big as reads well: centred at the
                  // editor's zoom, a short one sat small in a big white
                  // canvas and a long one ran off the bottom.
                  fit
                  maxFitScale={1.25}
                  zoomControls
                />
              </div>
            ) : (
              <CodeLines code={mission.code} highlight={runningSource} />
            )}
          </div>

          </div>
        </div>
      </div>
    </main>
  );
}
