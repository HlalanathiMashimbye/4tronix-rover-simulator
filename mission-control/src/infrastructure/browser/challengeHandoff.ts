/**
 * Carries a finished Blockly challenge's solution from the Progressive
 * Challenges workspace into Create Mission.
 *
 * sessionStorage, not localStorage: this is a one-shot handoff for the
 * navigation that is about to happen, not a persisted preference.
 * consumeChallengeHandoff() reads-and-clears, so a stale entry can never
 * silently reapply on a later, unrelated visit to /mission.
 */

const STORAGE_KEY = 'rover-challenge-handoff';

export interface ChallengeHandoffPayload {
  challengeId: string;
  challengeTitle: string;
  code: string;
  blocklyState: string;
}

export function writeChallengeHandoff(payload: ChallengeHandoffPayload): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage unavailable - the export step still completes the
    // challenge, it just won't pre-fill Create Mission.
  }
}

export function consumeChallengeHandoff(): ChallengeHandoffPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw) as ChallengeHandoffPayload;
  } catch {
    return null;
  }
}
