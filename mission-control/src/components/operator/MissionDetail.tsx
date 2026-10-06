'use client';

import { ArrowDown, ArrowLeft, Code2, MapPin, Video } from 'lucide-react';

import { MissionActions } from '@/components/operator/MissionActions';
import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';
import { MissionRuns } from '@/components/operator/MissionRuns';
import { useRef, useState } from 'react';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
import { CodeLines } from '@/components/mission/CodeLines';
import { MissionPreview } from '@/components/operator/MissionPreview';
import type { CommandSource } from '@/lib/roverBlockly';
import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';
import type { ConsoleMode } from '@/core/domain/services/consoleMode';
import { yardLabelOf, findYardIn, type Yard } from '@/core/domain/entities/Yard';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

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
  // What the preview's simulation is running, lit up in the code beside it.
  const [runningSource, setRunningSource] = useState<CommandSource | null>(null);
  // Whether the operator has scrolled past the first screen, so the cue
  // pointing at the record below can step aside.
  const [scrolledDown, setScrolledDown] = useState(false);
  const recordRef = useRef<HTMLDivElement>(null);

  if (!mission) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/60 p-6">
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          Pick a mission on the left to see its code, its runs and what a learner has been
          told about it.
        </p>
      </div>
    );
  }

  return (
    // THE FIRST SCREEN IS THE DECISION. The header, the preview and the code
    // at a size worth looking at, and the yard checks with Send to Rover at
    // its foot, fill exactly the panel's height; the record of the mission
    // (Mark complete, the runs, the video) is below the fold, with a cue that
    // says so. Squeezing everything into one screen without scrolling made
    // the simulator and the blocks too cramped to judge a mission by.
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

      {/* WHAT IT WILL DO, BESIDE WHAT WAS WRITTEN. The decision comes before
          the sending: an operator could only read the code and imagine the
          rover, or leave the console to watch it run elsewhere. Side by side
          when the pane is wide enough (a container query, because this pane's
          width is not the window's), stacked when it is not. The code lights
          up as the preview plays, as it does in the editor. */}
      {/* Stacked in a narrow panel, the code gets a little more than the
          preview: the preview's yard is wide and short, the program tall. */}
      <div className="grid min-h-[340px] flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2 @2xl:min-h-[300px] @2xl:grid-cols-2 @2xl:grid-rows-1 @2xl:gap-3">
        {/* Keyed on the mission: a new mission is a new run from the start,
            never the last mission's playhead. */}
        <MissionPreview key={mission.id} mission={mission} yardId={yardId} onSourceChange={setRunningSource} />

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-background/40">
          {/* Not on a phone: the blocks are plainly the learner's, and the
              row is worth more as canvas there. */}
          <h3 className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground @max-md:hidden">
            <Code2 className="h-3.5 w-3.5" />
            What the learner wrote
          </h3>
          {mission.blocklyState ? (
            <div className="min-h-0 flex-1">
              <BlocklyViewer key={mission.id} state={mission.blocklyState} highlight={runningSource} fit />
            </div>
          ) : (
            <CodeLines code={mission.code ?? ''} highlight={runningSource} />
          )}
        </section>
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
