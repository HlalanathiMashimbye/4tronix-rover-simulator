/**
 * Hands out mission names, each once.
 *
 * A mission's three words are how a learner finds it again, so no two
 * missions may share them (David, 8 October 2026). The words come from
 * missionNameForNumber, which is one-to-one; what this owns is the counter
 * behind it, which has to live somewhere every submission can see, and the
 * guarantee that two submissions at the same moment never get the same number.
 *
 * Its own interface rather than a method on the mission repository: the
 * mission service is the one thing that needs it, and only to submit.
 */
export interface IMissionNameRegistry {
  /** The next unused name. Never the same name twice, whoever else is sending at the time. */
  takeNext(): Promise<string>;
}
