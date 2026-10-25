/**
 * Live views of missions, for the screens that update as missions move.
 *
 * Components used to import these subscriptions straight from the Firestore
 * modules, so the View talked to the database and the "only the composition
 * root builds a repository" rule guarded the one-shot reads and not the live
 * ones. These are the ports; container.browser.ts hands out the Firestore
 * implementations, and architecture.test.ts fails if a component imports
 * persistence directly again.
 *
 * Every subscription returns the function that ends it. `onError` is required
 * on the operator's feeds because a listener that fails silently renders an
 * empty queue, which looks exactly like a quiet one.
 */

import type { Mission, MissionStatus } from '../entities/Mission';
import type { MissionRun } from '../entities/MissionRun';

export type Unsubscribe = () => void;

/** The fields of a mission the operator console shows, and no more. */
export interface QueueMission {
  id: string;
  name?: string;
  code: string;
  blocklyState?: string;
  status: MissionStatus;
  submittedAt?: string;
  /** Set when the mission finished. Absent on anything still open, and on a
   *  cancelled mission, which is why the query cannot order by it. */
  completedAt?: string;
  needsReview?: boolean;
  reviewReason?: string | null;
  /** Present once an operator has attached the recording. */
  youtubeUrl?: string;
}

export interface IOperatorQueueFeed {
  /** A yard's open missions, newest first. `olderHidden` when more wait than one read shows. */
  subscribeToYardQueue(
    yardId: string,
    onMissions: (missions: QueueMission[], olderHidden: boolean) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;

  /** A yard's settled missions, `pages` pages of them, most recently finished first. */
  subscribeToYardCompleted(
    yardId: string,
    onMissions: (missions: QueueMission[], hasMore: boolean) => void,
    onError: (error: Error) => void,
    pages?: number,
  ): Unsubscribe;

  subscribeToMission(
    missionId: string,
    onMission: (mission: QueueMission | null) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;

  subscribeToMissionRuns(
    missionId: string,
    onRuns: (runs: MissionRun[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

export interface ILearnerMissionFeed {
  /** A learner's own missions, found by the hash of their id. */
  subscribeMissionsByLearnerId(learnerId: string, callback: (missions: Mission[]) => void): Promise<Unsubscribe>;

  /** Missions sent from another device, found by the hash of the learner's address. */
  subscribeMissionsByLearnerEmail(learnerEmail: string, callback: (missions: Mission[]) => void): Promise<Unsubscribe>;

  /** The latest completions, for the bell. */
  subscribeRecentCompletions(callback: (missions: Mission[]) => void, max?: number): Unsubscribe;
}
