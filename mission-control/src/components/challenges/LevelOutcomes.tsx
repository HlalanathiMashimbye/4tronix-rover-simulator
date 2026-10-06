import Link from 'next/link';
import { GraduationCap, Rocket, Sparkles, Target } from 'lucide-react';
import type { ChallengeLevel, LearningOutcome } from '@/core/domain/entities/Challenge';
import { challengesPractising } from '@/core/domain/services/curriculumOutcomes';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { CSTA_STANDARDS } from '@/infrastructure/config/curriculumStandards';

/**
 * A level's "You will be able to ..." list (AB#444). Shared by the hub's level
 * card and the briefing before a level's first challenge, so the two can never
 * describe a level differently.
 *
 * Two readers, two depths. The sentence and "Practised in" are for the
 * learner and a parent; the standards sit behind a "For teachers" disclosure
 * with CSTA's full wording, because a bare code is a claim nobody reading it
 * can check. A <details> rather than a hover tooltip: hover does not exist on
 * the tablets and phones this is used on.
 *
 * linkChallenges is false on a locked level, where the hub renders its
 * challenges as inert too - a link here would be a way round the lock.
 */
export function LevelOutcomes({ level, linkChallenges }: { level: ChallengeLevel; linkChallenges: boolean }) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-primary">
        <Target className="h-3.5 w-3.5" />
        By the end of this level
      </h3>
      <ul className="mt-2 space-y-3">
        {level.outcomes.map((outcome) => (
          <li key={outcome.id} data-outcome-id={outcome.id} className="text-sm">
            <p className="text-foreground">{outcome.text}</p>
            <PractisedIn level={level} outcomeId={outcome.id} linkChallenges={linkChallenges} />
            <ForTeachers outcome={outcome} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The same list, folded to one "What you'll learn" line - how both the hub's
 * level cards and the briefing show it. Open, it was three paragraphs of small
 * print between a child and the thing they came to press (the map's nodes,
 * Start Mission); folded, it is one tap away for the parent or teacher who
 * wants it. One component so the hub and the briefing fold it the same way.
 */
export function LevelOutcomesFold({ level, linkChallenges }: { level: ChallengeLevel; linkChallenges: boolean }) {
  return (
    <details className="group mt-4 rounded-2xl border-2 border-kid-panel-edge">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-kid-muted-text hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-kid-blue/60 [&::-webkit-details-marker]:hidden">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
        What you&apos;ll learn
        <span aria-hidden="true" className="ml-auto transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">
        <LevelOutcomes level={level} linkChallenges={linkChallenges} />
      </div>
    </details>
  );
}

function PractisedIn({
  level,
  outcomeId,
  linkChallenges,
}: {
  level: ChallengeLevel;
  outcomeId: string;
  linkChallenges: boolean;
}) {
  const challenges = challengesPractising(level, outcomeId, CHALLENGES);
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      Practised in:{' '}
      {challenges.map((challenge, i) => (
        <span key={challenge.id}>
          {i > 0 && ', '}
          {linkChallenges ? (
            <Link href={`/challenges/${challenge.id}`} className="font-semibold text-primary hover:underline">
              {challenge.title}
            </Link>
          ) : (
            <span className="font-semibold">{challenge.title}</span>
          )}
        </span>
      ))}
    </p>
  );
}

function ForTeachers({ outcome }: { outcome: LearningOutcome }) {
  const { csta = [], nasaJpl, caps } = outcome.alignment;
  return (
    <details className="group mt-1">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
        <GraduationCap className="h-3 w-3" />
        For teachers
      </summary>
      <dl className="mt-1.5 space-y-1.5 border-l-2 border-border/60 pl-2.5 text-xs text-muted-foreground">
        {csta.map((code) => {
          const standard = CSTA_STANDARDS[code];
          return (
            <div key={code}>
              <dt className="font-bold text-foreground">
                CSTA {code}
                {standard && <span className="font-normal text-muted-foreground"> · {standard.gradeBand}</span>}
              </dt>
              {standard && <dd>{standard.text}</dd>}
            </div>
          );
        })}
        {nasaJpl && (
          <div>
            <dt className="flex items-center gap-1 font-bold text-foreground">
              <Rocket className="h-3 w-3 text-primary" />
              NASA JPL
            </dt>
            <dd>{nasaJpl}</dd>
          </div>
        )}
        {caps && (
          <div>
            <dt className="font-bold text-foreground">CAPS</dt>
            <dd>{caps}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
