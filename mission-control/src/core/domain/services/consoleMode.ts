/**
 * Whether the operator is doing the bookkeeping, or the platform is.
 *
 * Some of what an operator does today is only manual because nothing does it
 * yet. Marking a mission complete is really the rover reporting that it
 * finished; attaching a video is really the linker finding the upload. Both
 * have automatic implementations either built or planned, and when they run
 * there is nothing for a person to press.
 *
 * So the actions are not removed when that lands. They grey out, and the mode
 * says why. An operator who has used this console for a month should not open
 * it one morning to find two buttons missing and no explanation; a disabled
 * button that says "the platform does this now" teaches the change.
 *
 * MODE IS A FACT, NOT A PREFERENCE. It will be derived from whether the yard's
 * satellite is online and syncing, because that is what decides whether the
 * automatic path can actually run. Until that check exists the console offers
 * a switch, which is a stand-in for the signal rather than a setting anybody
 * should want to keep.
 */

export type ConsoleMode = 'manual' | 'auto';

export type OperatorAction = 'complete' | 'cancel' | 'attach-video' | 'resolve' | 'feedback';

/**
 * The actions the platform performs for itself once automation is running.
 *
 * Cancel and resolve are deliberately absent: they are exception handling, and
 * an exception is the one thing that still needs a person. Feedback is absent
 * because it is the only part of this job that was never bookkeeping.
 */
const AUTOMATED: readonly OperatorAction[] = ['complete', 'attach-video'];

export function isHandledAutomatically(action: OperatorAction, mode: ConsoleMode): boolean {
  return mode === 'auto' && AUTOMATED.includes(action);
}

/** What to tell an operator hovering a greyed-out control. */
export function automatedReason(action: OperatorAction): string {
  switch (action) {
    case 'complete':
      return 'The rover reports when it has finished, so this is recorded for you.';
    case 'attach-video':
      return 'Uploads are matched to their mission by the MissionID in the description.';
    default:
      return 'The platform does this for you.';
  }
}
