'use client';

import { ArrowLeft, Code2, MapPin, Video } from 'lucide-react';

import { MissionActions } from '@/components/operator/MissionActions';
import { AutomaticDispatch } from '@/components/operator/AutomaticDispatch';
import { MissionRuns } from '@/components/operator/MissionRuns';
import { useState } from 'react';
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
    <div className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <header className="shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            // -ml-1.5 and the padding give it a 40px target without spending
            // a row on it: below lg this is the only way back to the queue.
            className="-ml-1.5 mb-0.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to the queue
          </button>
        )}
        <h2 className="truncate font-display text-lg font-bold text-foreground">
          {mission.name || 'Untitled mission'}
        </h2>
        {/* The document id is for a bug report, not for the operator's job.
            It keeps its line where there is height to spare and goes on a
            phone, where that line is one queue row. */}
        <p className="mt-0.5 hidden truncate font-mono text-[11px] text-muted-foreground sm:block">
          {mission.id}
        </p>
      </header>

      {/* WHAT IT WILL DO, BESIDE WHAT WAS WRITTEN. The decision comes before
          the sending: an operator could only read the code and imagine the
          rover, or leave the console to watch it run elsewhere. Side by side
          when the pane is wide enough (a container query, because this pane's
          width is not the window's), stacked when it is not. The code lights
          up as the preview plays, as it does in the editor. */}
      <div className="grid shrink-0 gap-3 @2xl:grid-cols-2">
        {/* Keyed on the mission: a new mission is a new run from the start,
            never the last mission's playhead. */}
        <MissionPreview key={mission.id} mission={mission} onSourceChange={setRunningSource} />

        <section className="flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-background/40">
          <h3 className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Code2 className="h-3.5 w-3.5" />
            What the learner wrote
          </h3>
          {mission.blocklyState ? (
            <div className="min-h-[220px] flex-1">
              <BlocklyViewer key={mission.id} state={mission.blocklyState} highlight={runningSource} />
            </div>
          ) : (
            <CodeLines code={mission.code ?? ''} highlight={runningSource} />
          )}
        </section>
      </div>

      {/* Then sending: it is what an operator opens a queued mission to do,
          and the record actions below it are what they do afterwards. */}
      {mode === 'auto' && (
        <AutomaticDispatch mission={mission} yardId={yardId} />
      )}

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
  );
}
