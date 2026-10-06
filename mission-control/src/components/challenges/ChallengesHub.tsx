'use client';

import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Lock, Play, Star } from 'lucide-react';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';
import { CHALLENGE_LEVELS, CHALLENGES } from '@/infrastructure/config/challenges';
import type { ChallengeId, ChallengeLevel, ChallengeLevelId } from '@/core/domain/entities/Challenge';
import { StaggeredEntrance } from '@/components/ui/StaggeredEntrance';
import { LevelOutcomes } from './LevelOutcomes';

/**
 * Progressive Challenges hub, drawn as a mission map: one zone per level, its
 * challenges as big round nodes on a path. Locking, in-progress and complete
 * states all derive from useChallengeProgress rather than being tracked here,
 * so this component has no state of its own beyond the loading flag the hook
 * already exposes.
 *
 * WHY NODES AND NOT THE OLD ROWS. A row per challenge put a title, a summary
 * and a small Start chip side by side, and every row looked alike whether it
 * was done, open or locked. A young learner needs one answer from this page -
 * "which one do I do now?" - so exactly one node glows, done ones carry a
 * star, and locked ones are visibly not buttons. Summaries moved to the
 * briefing that opens when a node is tapped, where there is room to read.
 */

type NodeState = 'done' | 'next' | 'open' | 'locked';

/** Spoken after the title, so the state is in the link's accessible name. */
const STATE_LABEL: Record<NodeState, string> = {
  done: 'Done',
  next: 'Up next',
  open: 'Ready',
  locked: 'Locked',
};

/**
 * One colour per level, so a zone is recognisable before it is read. Kept as
 * whole class strings rather than built from the tone name: Tailwind only
 * generates classes it can see written out in full.
 */
const ZONE_TONE: Record<ChallengeLevelId, { badge: string; heading: string; edge: string }> = {
  1: { badge: 'bg-kid-orange border-kid-orange-edge', heading: 'text-kid-orange-text', edge: 'border-kid-orange-edge/50' },
  2: { badge: 'bg-kid-blue border-kid-blue-edge', heading: 'text-kid-blue-text', edge: 'border-kid-blue-edge/50' },
  3: { badge: 'bg-kid-green border-kid-green-edge', heading: 'text-kid-green-text', edge: 'border-kid-green-edge/50' },
};

export function ChallengesHub() {
  const { loading, isLevelUnlocked, isChallengeComplete, completedCount, totalCount } =
    useChallengeProgress();
  const reduceMotion = useReducedMotion();

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-kid-panel-edge border-t-kid-blue" />
      </div>
    );
  }

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // The first unlocked, unfinished challenge in track order is the one that
  // glows. Everything else unlocked and unfinished is merely "Ready".
  const nextId: ChallengeId | undefined = CHALLENGE_LEVELS.filter((level) => isLevelUnlocked(level.id))
    .flatMap((level) => level.challengeIds)
    .find((id) => !isChallengeComplete(id));

  const stateOf = (id: ChallengeId, unlocked: boolean): NodeState =>
    isChallengeComplete(id) ? 'done' : !unlocked ? 'locked' : id === nextId ? 'next' : 'open';

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
            <Star className="h-7 w-7 fill-kid-orange text-kid-orange-edge" aria-hidden="true" />
            Your stars
          </span>
          <span className="font-display text-lg font-bold tabular-nums text-foreground">
            {completedCount} of {totalCount}
          </span>
        </div>
        <div
          className="mt-3 h-4 overflow-hidden rounded-full bg-kid-panel-edge"
          role="progressbar"
          aria-label="Challenges completed"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={completedCount}
        >
          <div
            className="h-full rounded-full bg-kid-green transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {CHALLENGE_LEVELS.map((level, index) => (
        <StaggeredEntrance key={level.id} index={index} reduceMotion={reduceMotion}>
          <LevelZone level={level} unlocked={isLevelUnlocked(level.id)} stateOf={stateOf} />
        </StaggeredEntrance>
      ))}
    </div>
  );
}

function LevelZone({
  level,
  unlocked,
  stateOf,
}: {
  level: ChallengeLevel;
  unlocked: boolean;
  stateOf: (id: ChallengeId, unlocked: boolean) => NodeState;
}) {
  const tone = ZONE_TONE[level.id];

  return (
    <section
      aria-labelledby={`level-${level.id}-title`}
      className={`rounded-3xl border-x-2 border-t-2 border-b-4 bg-kid-panel p-4 sm:p-5 ${
        unlocked ? tone.edge : 'border-kid-panel-edge'
      }`}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-b-4 font-display text-xl font-bold text-kid-ink ${
            unlocked ? tone.badge : 'border-kid-panel-edge bg-kid-panel-edge'
          }`}
        >
          {unlocked ? level.id : <Lock className="h-5 w-5 text-kid-muted-text" />}
        </span>
        <div className="min-w-0">
          <h2
            id={`level-${level.id}-title`}
            className={`font-display text-xl font-bold ${unlocked ? tone.heading : 'text-kid-muted-text'}`}
          >
            Level {level.id}: {level.title}
          </h2>
          <p className="text-sm text-kid-muted-text">
            {unlocked ? level.description : `Finish Level ${level.id - 1} to unlock this zone.`}
          </p>
        </div>
      </header>

      <div className="mt-4 rounded-2xl border-2 border-kid-panel-edge px-4 py-3">
        <LevelOutcomes level={level} linkChallenges={unlocked} />
      </div>

      <ol className="mt-5 flex flex-col items-center sm:flex-row sm:flex-wrap sm:items-start sm:justify-center">
        {level.challengeIds.map((id, i) => (
          <li key={id} className="flex flex-col items-center sm:flex-row sm:items-start">
            {i > 0 && (
              // The path between nodes: vertical on a phone, horizontal from sm.
              <span
                aria-hidden="true"
                className="my-1 h-6 w-0 border-l-4 border-dotted border-kid-panel-edge sm:mx-1 sm:my-0 sm:mt-10 sm:h-0 sm:w-10 sm:border-l-0 sm:border-t-4"
              />
            )}
            <MissionNode id={id} state={stateOf(id, unlocked)} />
          </li>
        ))}
      </ol>
    </section>
  );
}

const NODE_FACE: Record<NodeState, string> = {
  done: 'bg-kid-green border-kid-green-edge text-kid-ink',
  next: 'bg-kid-blue border-kid-blue-edge text-kid-ink animate-node-glow',
  open: 'bg-kid-panel border-kid-blue-edge text-kid-blue-text border-x-2 border-t-2',
  locked: 'bg-kid-panel-edge border-kid-panel-edge text-kid-muted-text',
};

function MissionNode({ id, state }: { id: ChallengeId; state: NodeState }) {
  const challenge = CHALLENGES[id];

  const face = (
    <span
      className={`flex h-20 w-20 items-center justify-center rounded-full border-b-[6px] transition-transform ${NODE_FACE[state]}`}
      aria-hidden="true"
    >
      {state === 'done' && <Star className="h-9 w-9 fill-current" />}
      {state === 'next' && <Play className="ml-1 h-9 w-9 fill-current" />}
      {state === 'open' && <Play className="ml-1 h-8 w-8" />}
      {state === 'locked' && <Lock className="h-7 w-7" />}
    </span>
  );

  const label = (
    <span className="mt-2 flex max-w-36 flex-col items-center text-center">
      <span
        className={`font-display text-base font-bold leading-tight ${
          state === 'locked' ? 'text-kid-muted-text' : 'text-foreground'
        }`}
      >
        {challenge.title}
      </span>
      <span
        className={`mt-1 rounded-full px-2 py-0.5 text-xs font-bold ${
          state === 'next'
            ? 'bg-kid-blue text-kid-ink'
            : state === 'done'
              ? 'text-kid-green-text'
              : 'text-kid-muted-text'
        }`}
      >
        <span className="sr-only"> - </span>
        {STATE_LABEL[state]}
      </span>
    </span>
  );

  if (state === 'locked') {
    return (
      <div aria-disabled="true" className="flex w-36 flex-col items-center">
        {face}
        {label}
      </div>
    );
  }

  return (
    <Link
      href={`/challenges/${id}`}
      className="group flex w-36 flex-col items-center rounded-3xl p-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-kid-blue/60 [&>span:first-child]:active:translate-y-0.5 [&>span:first-child]:hover:scale-105"
    >
      {face}
      {label}
    </Link>
  );
}
