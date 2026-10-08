/**
 * Feedback Message Bank (AB#471)
 *
 * Ready-written notes an operator can send a learner about a run in one click,
 * so routine runs get a good note without the operator writing one, and the
 * operator's own words are kept for the runs that need them.
 *
 * THIS LIST IS REVIEWED CONTENT, LIKE THE MISSION-NAME WORDS. Every message
 * here reaches a child, under the operator's name, on their mission page.
 * Adding or changing one is a content change to review, not a copy edit -
 * feedbackMessages.test.ts holds each to the rules a reviewer would check:
 * short enough to read in the one line the learner's page gives it, no
 * leftover placeholders, and no two the same.
 *
 * WHY GROUPED BY OUTCOME. A run that went well, a run that hit something and a
 * run an operator had to stop need different things said. The same "Good
 * job!" on all three is the generic feedback this exists to replace: each
 * message says what happened and one thing to do next time.
 *
 * Crash messages name what was hit ({thing}: "a rock" or "the wall"), filled
 * from the crash check the operator's preview already runs (AB#466), because
 * "you hit the wall" is something a learner can act on and "you crashed" is
 * not. Stopped messages point at the slopes, which the learner's simulator
 * shows as coloured ground (AB#468): a stalled or tipping rover is almost
 * always a route over the mounds.
 */

import type { Crash } from '@/core/domain/safety/crashCheck';
import type { MissionStatus } from '@/core/domain/entities/Mission';

export type FeedbackOutcome = 'success' | 'crash' | 'stopped';

export const FEEDBACK_OUTCOME_LABELS: Record<FeedbackOutcome, string> = {
  success: 'Went well',
  crash: 'Hit something',
  stopped: 'Had to stop it',
};

/** Where a crash message says what the rover hit. */
export const THING_PLACEHOLDER = '{thing}';

export const FEEDBACK_MESSAGES: Record<FeedbackOutcome, readonly string[]> = {
  success: [
    'Great driving! The rover did exactly what your code said. Next time, try a mission with a turn in it.',
    'Mission complete, start to finish! Ready for something harder? Try making the rover come back to the start.',
    'Nice work - the real rover matched your plan. Next time, try a loop so it can go further with less code.',
    'Well done, a clean run with no bumps! Next time, see if you can visit two places in one mission.',
    'Spot on - your timings were just right. Try a trickier shape next time, like a rectangle.',
    'Brilliant run! You planned it well. Next time, try a route that steers around one of the rocks.',
  ],
  crash: [
    'Great attempt! Your rover bumped into {thing}. Run it in the simulator first and watch where it stops.',
    'Good try! The rover drove into {thing}. Make that move a little shorter and it will fit.',
    'Nearly there! The rover reached {thing}. Check the edges of the yard in the simulator before you send it.',
    'Nice effort! Your route ran into {thing}. Try turning a little earlier to steer around it.',
    'So close! The rover met {thing}. The yard is smaller than it looks, so plan with shorter drives.',
    'Good thinking, but the rover hit {thing}. The simulator marks where - change your plan to miss it.',
  ],
  stopped: [
    'Good try! We stopped your rover to keep it safe. Look for the coloured hills in the simulator next time.',
    'We stopped this run partway to protect the rover. Plan a route around the steep ground the simulator shows.',
    'Thanks for your mission! It had to be stopped. The real yard has mounds - the simulator shows where they are.',
    'Your rover got stuck, so we stopped it. Try a route over flatter ground - the simulator colours the steep parts.',
    'We had to stop your rover early. Shorter moves are easier to keep safe on the bumpy parts of the yard.',
  ],
};

/** What a crash message calls the thing the rover hit, in a child's words. */
export function crashThing(crash: Pick<Crash, 'into'>): string {
  return crash.into === 'wall' ? 'the wall' : 'a rock';
}

/**
 * A bank message ready to send: {thing} filled in when the run is known to
 * have hit something, and a neutral word when it is not, so a message the
 * operator picks is never sent with a placeholder in it.
 */
export function fillFeedbackMessage(template: string, crash: Pick<Crash, 'into'> | null): string {
  return template.replaceAll(THING_PLACEHOLDER, crash ? crashThing(crash) : 'something');
}

/**
 * Which group to open first. A predicted crash wins, because it is the most
 * specific thing known about the run; a run that did not finish is next. Only
 * a suggestion: the operator watched the run and can open any group.
 */
export function suggestFeedbackOutcome(status: MissionStatus, crash: Pick<Crash, 'into'> | null): FeedbackOutcome {
  if (crash) return 'crash';
  if (status === 'failed' || status === 'cancelled') return 'stopped';
  return 'success';
}

/** Every message in the bank, for tests and for review. */
export function allFeedbackMessages(): string[] {
  return Object.values(FEEDBACK_MESSAGES).flat();
}
