/**
 * The challenge a learner is in the middle of, and which step - so a learner
 * a challenge sent to another page can get back to where they were.
 *
 * WHY. Level 1 sends learners to History, the Leaderboard and Create Mission.
 * Leaving the challenge page unmounted the workspace, the way back was the
 * Challenges map, and the challenge then opened on its briefing and step 1 -
 * so a child who had just done what step 2 asked had to click through it all
 * again to be told so.
 *
 * sessionStorage, not localStorage: this is "where was I" for the visit in
 * progress, unlike platformMilestones' facts about the learner that stay true
 * tomorrow. A tab closed is a visit over, and an offer to return to a
 * challenge from last week would be a surprise, not a help.
 *
 * Carries the learner id and is ignored for anyone else, because the yard is
 * used on shared classroom machines and a tab can outlive the child who
 * opened it.
 */

import { getLearnerID } from './getLearnerID';

const STORAGE_KEY = 'rover-active-challenge';

export interface ActiveChallenge {
  challengeId: string;
  stepIndex: number;
}

export function recordActiveChallenge(active: ActiveChallenge): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...active, learnerId: getLearnerID() }));
  } catch {
    // No sessionStorage: the learner returns through the map, as before.
  }
}

export function readActiveChallenge(): ActiveChallenge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveChallenge> & { learnerId?: string };
    if (parsed.learnerId !== getLearnerID()) return null;
    if (typeof parsed.challengeId !== 'string' || typeof parsed.stepIndex !== 'number') return null;
    return { challengeId: parsed.challengeId, stepIndex: parsed.stepIndex };
  } catch {
    return null;
  }
}

/** A finished challenge is nothing to return to. */
export function clearActiveChallenge(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
