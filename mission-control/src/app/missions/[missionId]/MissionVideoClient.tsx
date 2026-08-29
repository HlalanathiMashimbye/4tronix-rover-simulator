"use client";

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Rocket, Star, Zap } from 'lucide-react';
import { Mission } from '@/core/domain/entities/Mission';
import Link from 'next/link';
import { getFirestoreClient } from '@/lib/firebase';
import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
import { parseRoverCode } from '@/lib/parseRoverCode';
import { simulateCommands } from '@/lib/simulateCommands';
import { getDiscoveryStatus, DISCOVERY_BADGE_CLASS } from '@/lib/discoveryStatus';
import { useFavorites } from '@/lib/useFavorites';
import { SplitPane } from '@/components/ui/SplitPane';
import { yardLabel } from '@/infrastructure/config/yards';
import { buildRunOptions, type RunOption } from '@/lib/missionRuns';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { RunStackCarousel } from '@/components/mission/RunStackCarousel';


export default function MissionVideoClient({ missionId }: { missionId: string }) {
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
        const repository = new FirestoreMissionRepository(getFirestoreClient());
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
  const durationMs = mission.executionMetadata?.duration_ms;
  const durationLabel = durationMs ? `${Math.round(durationMs / 1000)}s` : 'Not yet';
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

        {/* Fixed at 70/30, video to code. The draggable divider was ambition:
            a video player wants one shape and looks better holding it, and a
            handle beside it invites fiddling with a layout that was already
            right. Create Mission keeps its drag, where trading space between
            an editor and a preview is a real working need.

            height="100%" because this sits inside an already-sized flex
            parent, unlike Create Mission which owns the viewport. */}
        <SplitPane
          ariaLabel="Footage and code panels"
          defaultSplit={70}
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
                <Stat label="Duration" value={durationLabel} mono />
                <Stat label="Built with" value={hasBlocks ? 'Blocks' : 'Python'} />
              </div>
            </div>
          }
          /* Code (scrolls internally) + remix */
          right={
            <div className="flex min-h-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60">
              <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2">
                {hasBlocks ? (
                  <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs font-semibold">
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
                    window.location.href = '/mission?mode=blockly';
                  } else {
                    localStorage.setItem('rover_monaco_code', mission.code);
                    window.location.href = '/mission?mode=code';
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
