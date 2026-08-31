"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Rocket, Star, Zap } from 'lucide-react';
import { browserMissionRepository } from '@/infrastructure/container.browser';
import { Mission } from '@/core/domain/entities/Mission';
import Link from 'next/link';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
import { parseRoverCode } from '@/lib/parseRoverCode';
import { simulateCommands } from '@/lib/simulateCommands';
import { getDiscoveryStatus, DISCOVERY_BADGE_CLASS } from '@/core/domain/services/discoveryStatus';
import { useFavorites } from '@/hooks/useFavorites';
import { SplitPane } from '@/components/ui/SplitPane';
import { yardLabel } from '@/infrastructure/config/yards';
import { buildRunOptions, type RunOption } from '@/lib/missionRuns';
import { durationLabel } from '@/lib/missionDuration';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { RunStackCarousel } from '@/components/mission/RunStackCarousel';
import { OperatorFeedback } from '@/components/mission/OperatorFeedback';


export default function MissionVideoClient({ missionId }: { missionId: string }) {
  const router = useRouter();
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
  const simTrajectory = useMemo(
    () => (mission ? simulateCommands(parseRoverCode(mission.code)) : []),
    [mission]
  );

  // Real runs come FIRST, which is the point: a child needs to see that an
  // actual rover drove their code. See lib/missionRuns for the reasoning.
  const runs = useMemo<RunOption[]>(
    () => buildRunOptions(mission, missionRuns),
    [mission, missionRuns],
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

  if (loading) {
    return (
      <main className="flex h-[calc(100vh-64px)] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary" />
      </main>
    );
  }

  if (error || !mission) {
    return (
      <main className="mx-auto flex h-[calc(100vh-64px)] max-w-md flex-col items-center justify-center px-6 text-center">
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
    try {
      await navigator.clipboard.writeText(mission.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    // Pinned to the viewport from md up, where the panels sit side by side and
    // a page that never scrolls is the point. On a phone they stack, so a
    // fixed 100vh with overflow-hidden CLIPPED the second panel entirely - the
    // blocks and the code were rendered, just unreachable, with no scrollbar to
    // hint that anything was below.
    <main className="px-3 py-2 md:h-[calc(100vh-64px)] md:overflow-hidden">
      <div className="mx-auto flex h-full max-w-page flex-col gap-2">
        {/* Header */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link href="/" className="shrink-0 text-muted-foreground transition-colors hover:text-primary" aria-label="Back to the feed">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="truncate font-display text-lg font-bold text-foreground md:text-xl">{missionName}</h1>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${DISCOVERY_BADGE_CLASS[discoveryStatus]}`}
            >
              {discoveryStatus}
            </span>
            <button
              onClick={() => toggleFavorite(mission.id, missionName)}
              aria-label={starred ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={starred}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-amber-400"
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
              {yardLabel(mission.yardId) ? `${yardLabel(mission.yardId)} · ` : ''}
              {dateLabel}
            </span>
          </div>
        </div>

        {/* Fixed at 60/40, video to code, and the number came from the
            simulator's geometry rather than taste.

            The yard is a 400x300 world - 4:3 - letterboxed by computeLayout
            inside whatever canvas it gets. So a WIDER panel makes it worse,
            not better. Measured, at a 1400px viewport:

              70/30  canvas 799x497 (1.61)  yard floats, 87px dead each side
              65/35  canvas 716x469 (1.53)  64px each side
              60/40  canvas 664x490 (1.35)  24px each side

            The two media want opposite shapes and no split serves both: 16:9
            video wants width, the 4:3 yard wants less of it. 60/40 is chosen
            because the failures are not equivalent. A letterboxed video is
            what every player does and nobody remarks on it; a yard floating in
            grey with a hand's width of nothing down each side reads as a
            rendering fault, which is exactly how it was reported.

            The 320px floor on the right track keeps the code readable, so this
            does not squeeze the editor to buy the change.

            height="100%" because this sits inside an already-sized flex
            parent, unlike Create Mission which owns the viewport. */}
        <SplitPane
          ariaLabel="Footage and code panels"
          defaultSplit={60}
          resizable={false}
          height="100%"
          left={
            <div className="flex min-h-0 flex-col gap-2">
              <RunStackCarousel
                runs={runs}
                selectedId={selectedRun.id}
                onSelect={setSelectedRunId}
                missionName={missionName}
                trajectory={simTrajectory}
              />
              <div className="grid shrink-0 grid-cols-3 gap-2">
                <Stat label="Status" value={discoveryStatus} />
                <Stat label="Duration" value={duration} mono />
                <Stat label="Built with" value={hasBlocks ? 'Blocks' : 'Python'} />
              </div>
              {/* Under the stats, where a learner looks after watching. Takes
                  the column's leftover height so this column ends level with
                  the code panel beside it, and so the panel does not shove the
                  stats upward the first time an operator writes something. */}
              <OperatorFeedback runs={missionRuns} />
            </div>
          }
          /* Code (scrolls internally) + remix */
          right={
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
                <button
                  onClick={copyCode}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copied ? 'Copied' : 'Copy Python'}
                </button>
              </div>
              {showBlocks ? (
                <div className="min-h-0 flex-1">
                  <BlocklyViewer state={mission.blocklyState!} />
                </div>
              ) : (
                <pre className="min-h-0 flex-1 overflow-auto p-4 text-xs leading-relaxed text-foreground">
                  <code>{mission.code.trim() || '# No code'}</code>
                </pre>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent px-4 py-3">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-foreground">Like this mission?</h3>
                <p className="truncate text-xs text-muted-foreground">Remix it: tweak the code and run your own version.</p>
              </div>
              <button
                onClick={() => {
                  // Remix into the workspace: carry blocks for block-built missions,
                  // otherwise the Python, and open the matching editor mode.
                  if (mission.blocklyState) {
                    localStorage.setItem('roverWorkspace', mission.blocklyState);
                    router.push('/mission?mode=blockly');
                  } else {
                    localStorage.setItem('rover_monaco_code', mission.code);
                    router.push('/mission?mode=code');
                  }
                }}
                className="clay clay-press inline-flex shrink-0 items-center gap-2 rounded-2xl bg-gradient-mars px-4 py-2.5 font-display text-sm font-bold text-primary-foreground"
              >
                <Zap className="h-4 w-4" fill="currentColor" />
                Remix
              </button>
            </div>
            </div>
          }
        />
      </div>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-3 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}
