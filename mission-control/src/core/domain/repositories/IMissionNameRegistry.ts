/**
 * Which mission names are taken, and the next one that is not.
 *
 * A mission's three words are how a learner finds it again, so no two
 * missions may share them (David, 8 October 2026). The learner rolls a name
 * for free in the browser; this is where it becomes theirs or does not, at
 * the one moment that matters, when the mission is sent.
 *
 * Its own interface rather than a method on the mission repository: the
 * mission service is the one thing that needs it, and only to submit.
 */
export interface IMissionNameRegistry {
  /**
   * Take `name` for a new mission. True if it was free and is now taken;
   * false if a mission already has it. Two missions claiming the same name at
   * the same moment get one true between them.
   */
  claim(name: string): Promise<boolean>;

  /** A name nobody has, for a mission whose own was taken. Never the same one twice. */
  takeNext(): Promise<string>;
}
