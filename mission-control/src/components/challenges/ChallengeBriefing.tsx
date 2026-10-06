'use client';

import { useState } from 'react';
import { Check, GraduationCap, Rocket } from 'lucide-react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { ChallengeWorkspace } from './ChallengeWorkspace';
import { describeCheck } from './describeCheck';
import { pillClass } from './pill';

/**
 * The challenge page shows a short briefing first and the workspace only once
 * the learner presses Start Mission.
 *
 * A gate around ChallengeWorkspace rather than a mode inside it: the
 * workspace owns step navigation, live checks and the finish handoff, and has
 * no reason to know a briefing came before it. Keeping the two apart also
 * keeps the workspace's own tests rendering the workspace directly.
 */
export function ChallengeBriefingGate({ challenge }: { challenge: Challenge }) {
  const [started, setStarted] = useState(false);
  if (started) return <ChallengeWorkspace challenge={challenge} />;
  return <ChallengeBriefing challenge={challenge} onStart={() => setStarted(true)} />;
}

const EDITOR_LABEL: Record<Challenge['workspaceKind'], string> = {
  'embedded-platform': 'The live Mission Control site',
  'blockly-sim': 'Blockly blocks, with the rover simulator',
  'monaco-sim': 'Typed Python, with the rover simulator',
};

/**
 * Mission Goals are the challenge's step titles, not a separately written
 * list. Steps are already short imperative phrases ("Drive forward", "Add a
 * turn"), there are two to four of them, and they are exactly what the
 * learner will be asked to do - a second list would be a second copy of the
 * content to keep in step with the first.
 */
export function ChallengeBriefing({ challenge, onStart }: { challenge: Challenge; onStart: () => void }) {
  return (
    <div className="scroll-panel min-h-0 flex-1 overflow-y-auto pb-4">
      <section
        aria-labelledby="mission-goals-title"
        className="mx-auto mt-2 max-w-2xl rounded-3xl border-x-2 border-t-2 border-b-4 border-kid-panel-edge bg-kid-panel p-5 sm:p-7"
      >
        <h2 id="mission-goals-title" className="font-display text-2xl font-bold text-foreground">
          Mission Goals
        </h2>

        <ol className="mt-4 space-y-3">
          {challenge.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-b-4 border-kid-green-edge bg-kid-green text-kid-ink"
              >
                <Check className="h-6 w-6" strokeWidth={3} />
              </span>
              <span className="font-display text-lg font-semibold text-foreground">{step.title}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex justify-center">
          <button type="button" onClick={onStart} autoFocus className={pillClass('green', 'lg')}>
            <Rocket className="h-6 w-6" aria-hidden="true" />
            Start Mission
          </button>
        </div>

        <TeacherInfo challenge={challenge} />
      </section>
    </div>
  );
}

/**
 * Teacher-facing detail, folded away so it is one tap from a teacher and out
 * of a child's way.
 *
 * A native <details>: keyboard and screen-reader support come with the
 * element, and it works before hydration.
 *
 * NO CURRICULUM CODES. The panel says so rather than leaving the reader to
 * wonder. CAPS/CSTA codes were taken out of the content because nobody on the
 * team can vouch for the mapping (see infrastructure/config/challenges.ts),
 * and moving an unverified claim into a teacher panel does not make it
 * verified - a teacher is the one reader who would check it. What is listed
 * here is what the code actually enforces: the checks each step runs.
 */
function TeacherInfo({ challenge }: { challenge: Challenge }) {
  return (
    <details className="group mt-6 rounded-2xl border-2 border-kid-panel-edge">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-kid-muted-text hover:text-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-kid-blue/60 [&::-webkit-details-marker]:hidden">
        <GraduationCap className="h-5 w-5" aria-hidden="true" />
        Teacher &amp; Standards Info
        <span aria-hidden="true" className="ml-auto transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="space-y-4 px-4 pb-4 text-sm text-foreground">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-bold text-kid-muted-text">Level</dt>
          <dd>{challenge.levelId}</dd>
          <dt className="font-bold text-kid-muted-text">Works in</dt>
          <dd>{EDITOR_LABEL[challenge.workspaceKind]}</dd>
          <dt className="font-bold text-kid-muted-text">Points</dt>
          <dd>{challenge.scorePoints}</dd>
          <dt className="font-bold text-kid-muted-text">Standards</dt>
          <dd>Not mapped. A curriculum code is listed here only once a teacher has checked the mapping.</dd>
        </dl>

        <div>
          <h3 className="font-bold text-kid-muted-text">How each step is checked</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {challenge.steps.map((step) => (
              <li key={step.id}>
                <span className="font-semibold">{step.title}:</span>{' '}
                {step.checks.length > 0
                  ? step.checks.map(describeCheck).join('; ')
                  : 'Nothing automatic - pressing Finish completes it.'}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}
