'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, OctagonX } from 'lucide-react';
import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { useMissionTrajectory } from '@/hooks/useMissionTrajectory';
import { previewMission, type FindingLevel } from '@/core/domain/safety/missionPreview';
import type { CommandSource } from '@/lib/roverBlockly';
import type { QueueMission } from '@/infrastructure/persistence/operatorQueueService';

/**
 * What the mission will do, before it goes to the real rover.
 *
 * The console showed the code and nothing else, so judging a mission meant
 * reading Python and imagining the rover, or leaving the console to watch it
 * elsewhere. This plays it in the same simulator the learner used, from the
 * stored code (no extra reads: the console has already loaded it), and lists
 * what to look at worst first: problems in the code, a run over the limit,
 * the rover reaching the edge of the simulator's yard and when.
 *
 * Plays on open, because the operator opened the mission to see it. The code
 * beside it lights up as it runs (onSourceChange), as in the editor.
 */
export function MissionPreview({
  mission,
  onSourceChange,
}: {
  mission: QueueMission;
  onSourceChange: (source: CommandSource | null) => void;
}) {
  const trajectory = useMissionTrajectory(mission);
  const findings = useMemo(() => previewMission(mission.code, trajectory), [mission.code, trajectory]);
  const worst = findings[0]?.level ?? 'ok';

  return (
    <section aria-label="What it will do" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-background/40">
      <h3 className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        What it will do
        <span className={`rounded-full px-2 py-0.5 text-[10px] tracking-[0.12em] ${VERDICT_CLASS[worst]}`}>{VERDICT_LABEL[worst]}</span>
      </h3>

      {/* 4:3, the simulator's own yard, so it is drawn without letterboxing. */}
      <div className="relative aspect-[4/3] w-full shrink-0">
        <RoverSimulator
          trajectory={trajectory}
          isPlaying
          editorMode="code"
          bare
          onSourceChange={onSourceChange}
        />
      </div>

      <ul className="shrink-0 space-y-1 px-3 py-2.5 text-xs">
        {findings.map((finding) => {
          const Icon = ICON[finding.level];
          return (
            <li key={finding.id} data-level={finding.level} className="flex items-start gap-2">
              <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${ICON_CLASS[finding.level]}`} aria-hidden="true" />
              <span className={finding.level === 'ok' ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                {finding.message}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const ICON: Record<FindingLevel, typeof CheckCircle2> = { stop: OctagonX, warn: AlertTriangle, ok: CheckCircle2 };
const ICON_CLASS: Record<FindingLevel, string> = {
  stop: 'text-destructive',
  warn: 'text-amber-500',
  ok: 'text-buzz',
};
const VERDICT_LABEL: Record<FindingLevel, string> = { stop: 'Fix first', warn: 'Look first', ok: 'Looks fine' };
const VERDICT_CLASS: Record<FindingLevel, string> = {
  stop: 'bg-destructive/15 text-destructive',
  warn: 'bg-amber-500/15 text-amber-600',
  ok: 'bg-buzz/15 text-buzz',
};
