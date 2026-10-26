'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Circle, Star, Target, X } from 'lucide-react';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { readActiveChallenge, type ActiveChallenge } from '@/infrastructure/browser/activeChallenge';
import { normaliseRoute } from '@/infrastructure/browser/platformMilestones';
import type { ChallengeId } from '@/core/domain/entities/Challenge';
import { describeCheck } from './describeCheck';
import { pillClass } from './pill';

/**
 * A way back to the challenge a learner is in the middle of, on whichever
 * page a challenge sent them to.
 *
 * Level 1 asks learners to open History, the Leaderboard and Create Mission.
 * The only way back was the Challenges map, which then started the challenge
 * over from its briefing. This sits in the root layout, like
 * MilestoneTracker, because it belongs to every page and to none of them.
 *
 * Not on the challenge pages themselves (that is where it leads), and not on
 * the operator console (an operator is not doing a challenge). Closing it
 * hides it for this page only: the challenge is still unfinished, and the
 * next page a learner opens should still offer the way back.
 *
 * When the page is the one the learner's current step asked them to open, it
 * says they found it - that is the moment the step was being waited on.
 */
export function ReturnToChallenge() {
  const pathname = usePathname();
  const [active, setActive] = useState<ActiveChallenge | null>(null);
  const [closedOn, setClosedOn] = useState<string | null>(null);

  // Read on every navigation: the record changes on the challenge page, and
  // sessionStorage does not exist in the server render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is browser-only
    setActive(readActiveChallenge());
  }, [pathname]);

  if (!pathname || !active) return null;
  const here = normaliseRoute(pathname);
  if (here.startsWith('/challenges') || here.startsWith('/operator') || closedOn === here) return null;

  const challenge = CHALLENGES[active.challengeId as ChallengeId];
  const step = challenge?.steps[active.stepIndex];
  if (!challenge || !step) return null;

  const foundIt = step.checks.some((check) => check.kind === 'route-visited' && check.path === here);

  return (
    <aside
      aria-label="Your challenge"
      data-surface="challenges"
      className="fixed top-[calc(var(--app-chrome)+0.5rem)] left-3 right-3 z-40 md:top-auto md:bottom-6 md:left-auto md:right-6 md:w-96"
    >
      <div className="pop-in max-h-[50vh] overflow-y-auto rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-b-2 text-kid-ink ${
                foundIt ? 'border-kid-green-edge bg-kid-green' : 'border-kid-orange-edge bg-kid-orange'
              }`}
            >
              {foundIt ? <Star className="h-4 w-4 fill-current" /> : <Target className="h-4 w-4" />}
            </span>
            <p className="font-display text-sm font-bold text-kid-muted-text">
              {challenge.title}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setClosedOn(here)}
            aria-label="Hide this for now"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-kid-muted-text hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <h2 className="mt-2 font-display text-lg font-bold text-foreground">{step.title}</h2>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">{step.instructions}</p>

        {step.checks.length > 0 && (
          <ul aria-label="What to do" className="mt-2 flex flex-wrap gap-1.5">
            {step.checks.map((check, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 rounded-full border-2 border-dashed border-kid-panel-edge px-2.5 py-1 text-xs font-bold text-kid-muted-text"
              >
                <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {describeCheck(check)}
              </li>
            ))}
          </ul>
        )}

        {foundIt && (
          <p className="mt-2 text-sm font-bold text-kid-green-text">
            You found it! Go back and tick it off.
          </p>
        )}

        <Link href={`/challenges/${challenge.id}`} className={`${pillClass('blue')} mt-3`}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Back to my challenge
        </Link>
      </div>
    </aside>
  );
}
