'use client';

import { ArrowLeft, Code2, MapPin, Video } from 'lucide-react';

import { MissionActions } from '@/components/operator/MissionActions';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
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
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <header className="shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary lg:hidden"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to the queue
          </button>
        )}
        <h2 className="font-display text-lg font-bold text-foreground">
          {mission.name || 'Untitled mission'}
        </h2>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{mission.id}</p>
      </header>

      <MissionActions
        mission={mission}
        yardId={yardId}
        isAdmin={isAdmin}
        mode={mode}
        onResult={onResult}
      />

      {/* Every yard that has attempted this, not just the one this operator
          signed in at. A mission is not yard-scoped even though the queue is,
          and knowing Durban already ran it is the difference between running
          it again and leaving it alone. Only this operator's own run is
          actionable, which the API enforces. */}
      {runs.length > 0 && (
        <section className="shrink-0 rounded-2xl border border-border/50 bg-background/40 p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {runs.length === 1 ? 'One run' : `${runs.length} runs`}
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {runs.map((run) => {
              const yard = findYardIn(yards, run.yardId);
              const mine = run.yardId === yardId;
              return (
                <li key={run.yardId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className={mine ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                      {yard ? yardLabelOf(yard) : run.yardId}
                    </span>
                    {mine && <span className="ml-1.5 text-[11px] text-primary">yours</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{run.status}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border/50 bg-background/40">
        <h3 className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Code2 className="h-3.5 w-3.5" />
          What the learner wrote
        </h3>
        {mission.blocklyState ? (
          <div className="min-h-[220px] flex-1">
            <BlocklyViewer state={mission.blocklyState} />
          </div>
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-relaxed text-foreground">
            <code>{mission.code?.trim() || '# No code'}</code>
          </pre>
        )}
      </section>
    </div>
  );
}
