'use client';

import { ArrowDown, ArrowLeft, MapPin, Video } from 'lucide-react';

import { MissionActions } from '@/components/operator/MissionActions';
import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';
import { MissionRuns } from '@/components/operator/MissionRuns';
import { useMemo, useRef, useState } from 'react';
import { MissionPreview } from '@/components/operator/MissionPreview';
import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';
import type { ConsoleMode } from '@/core/domain/services/consoleMode';
import { yardLabelOf, findYardIn, type Yard } from '@/core/domain/entities/Yard';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import { findCrash } from '@/core/domain/safety/crashCheck';
import { useYardLayout } from '@/hooks/useYardLayout';
import { useMissionTrajectory } from '@/hooks/useMissionTrajectory';

/**
 * One mission, beside the queue rather than instead of it.
 *
 * The queue answers "who is next"; this answers "what do I do about this one".
 * They used to be the same accordion row, which meant the code pushed every
 * other mission off the screen to be read, and meant the work that survives
 * automation - reading a run and writing a sentence back to a child - happened
 * in a space sized for a list item.
 */
export function MissionDetail({
  mission,
  runs,
  yards,
  yardId,
  isAdmin,
  mode,
  onResult,
  onBack,
}: {
  mission: QueueMission | null;
  runs: MissionRun[];
  yards: Yard[];
  yardId: string;
  isAdmin: boolean;
  mode: ConsoleMode;
  onResult: (message: string) => void;
  /** Only rendered on small screens, where the two panes take turns. */
  onBack?: () => void;
}) {
  // Whether the operator has scrolled past the first screen, so the cue
  // pointing at the record below can step aside.
  const [scrolledDown, setScrolledDown] = useState(false);
  const recordRef = useRef<HTMLDivElement>(null);

  // Simulated once, here, for the two things below that need it: the preview
  // draws it, and the feedback bank reads what it hit (AB#471). Each running
  // its own simulation meant a block mission built its hidden Blockly
  // workspace twice for one mission.
  const { layout } = useYardLayout(yardId);
  const trajectory = useMissionTrajectory(mission, layout);
  const crash = useMemo(() => findCrash(trajectory), [trajectory]);

  if (!mission) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/60 p-6">
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          Pick a mission on the left to see what it will do, its runs and what a learner has
          been told about it.
        </p>
      </div>
    );
  }

  return (
    // THE FIRST SCREEN IS THE DECISION. The header, the preview at a size
    // worth looking at, and the yard checks with Send to Rover at its foot; the record of the mission
    // (Mark complete, the runs, the video) is below the fold, with a cue that
    // says so. Squeezing everything into one screen without scrolling made
    // the simulator too cramped to judge a mission by.
    <div
      className="@container h-full min-h-0 overflow-y-auto"
      onScroll={(event) => setScrolledDown(event.currentTarget.scrollTop > 40)}
    >
    <div className="flex min-h-full flex-col gap-3">
      {/* ONE ROW: the way back, the name, the id. They were three stacked
          lines with a whole row of nothing beside "Back to the queue". The
          back button is an arrow with its words as its label, and only below
          lg, where the panes take turns. The id is for a bug report, not the
          operator's job, so it trails the name and goes on a phone. */}
      <header className="flex shrink-0 items-center gap-1.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to the queue"
            title="Back to the queue"
            className="-ml-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-primary lg:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h2 className="min-w-0 truncate font-display text-lg font-bold text-foreground">
          {mission.name || 'Untitled mission'}
        </h2>
        <p className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:block">{mission.id}</p>
      </header>

      {/* WHAT IT WILL DO, AND NOTHING ELSE. The operator decides on
          execution, not on the learner's code: the code used to share this
          row and nobody at the yard reads it to run a mission. The preview
          takes the whole pane. Yard checks stay a full-width row beneath it:
          squeezed into a column beside the preview they wrapped and
          overflowed sideways. */}
      <div className="grid min-h-[340px] flex-1 grid-rows-1 @2xl:min-h-[300px]">
        {/* Keyed on the mission: a new mission is a new run from the start,
            never the last mission's playhead. */}
        <MissionPreview key={mission.id} mission={mission} yardId={yardId} trajectory={trajectory} />
      </div>

      {/* Then sending: it is what an operator opens a queued mission to do,
          and the record actions below it are what they do afterwards. */}
      {mode === 'auto' && (
        <div className="shrink-0">
          <AutomaticDispatch mission={mission} yardId={yardId} />
        </div>
      )}

      {/* The way to everything below the fold, so it is never a secret that
          there is more. Fades once the operator has scrolled. Not worded
          "Mark complete": that is the name of the button it leads to, and
          two buttons answering to one name confuse a screen reader. */}
      <button
        type="button"
        onClick={() => recordRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        aria-hidden={scrolledDown}
        tabIndex={scrolledDown ? -1 : 0}
        className={`-mt-0.5 flex shrink-0 items-center justify-center gap-1.5 self-center rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-opacity duration-200 hover:bg-primary/15 ${
          scrolledDown ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <ArrowDown className="h-4 w-4 text-primary motion-safe:animate-bounce" />
        Scroll for actions, runs and video
      </button>
    </div>

      <div ref={recordRef} className="flex scroll-mt-2 flex-col gap-3 pb-2 pt-4">
      <MissionActions
        mission={mission}
        crash={crash}
        yardId={yardId}
        isAdmin={isAdmin}
        mode={mode}
        onResult={onResult}
      />

      <MissionRuns
        missionId={mission.id}
        runs={runs}
        yards={yards}
        yardId={yardId}
        mode={mode}
        onResult={onResult}
      />

      {mission.youtubeUrl && (
        <a
          href={mission.youtubeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <Video className="h-3.5 w-3.5" />
          Watch the run
        </a>
      )}
      </div>
    </div>
  );
}
