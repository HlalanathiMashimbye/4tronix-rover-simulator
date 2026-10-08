'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Star, Target, X } from 'lucide-react';
import { CHALLENGES } from '@/infrastructure/config/challenges';
import { readActiveChallenge, type ActiveChallenge } from '@/infrastructure/browser/activeChallenge';
import { normaliseRoute } from '@/infrastructure/browser/platformMilestones';
import type { ChallengeId } from '@/core/domain/entities/Challenge';
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
      className="fixed bottom-[calc(var(--app-bottom-chrome)+0.75rem)] left-3 right-20 z-50 md:bottom-6 md:left-auto md:right-6 md:w-96"
    >
      {/* pop-in: lands once, with the small bounce the rest of the app uses
          for something arriving (globals.css), and not at all under reduced
          motion. The same card as the challenge panels, so it reads as part
          of the challenge that sent the learner here. */}
      <div className="pop-in flex items-start gap-3 rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-blue-edge bg-kid-panel p-3 shadow-lg">
        <span
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-b-4 text-kid-ink ${
            foundIt ? 'border-kid-green-edge bg-kid-green' : 'border-kid-orange-edge bg-kid-orange'
          }`}
        >
          {foundIt ? <Star className="h-6 w-6 fill-current" /> : <Target className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold text-foreground">
            {foundIt ? 'You found it! Go back and tick it off.' : 'Your challenge is waiting for you!'}
          </p>
          <p className="truncate text-xs text-kid-muted-text">
            {challenge.title}: {step.title}
          </p>
          <Link href={`/challenges/${challenge.id}`} className={`${pillClass('blue')} mt-2`}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Back to my challenge
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setClosedOn(here)}
          aria-label="Hide this for now"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-kid-muted-text hover:text-foreground"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
