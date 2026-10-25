/**
 * Operator bookkeeping: what an operator can do to a mission's record from a
 * desk. Complete, cancel, log another run, attach or remove a video, resolve a
 * review, leave feedback, delete a run, delete a mission.
 *
 * The decisions are the Mission entity's. This is the application around
 * them: checking every yard and run id the request names, choosing which run
 * to write, and emailing the learner. It takes a repository, a notifier and an
 * id generator, so it tests without Firebase, and the route keeps only what a
 * route is for: authenticate, parse, and turn a result into HTTP.
 *
 * NOTHING HERE CAN MOVE A ROVER. It records decisions and never dispatches.
 * operator-bookkeeping-inert.test.ts reads this file as well as the route.
 */

import {
  Mission,
  type Decision,
  type MissionRecord,
  type MissionStatus,
  type ResolveOutcome,
} from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type {
  IMissionBookkeeping,
  IMissionReader,
} from '@/core/domain/repositories/IMissionRepository';
import { getYouTubeId } from '@/core/domain/services/youtubeLinking';
import type { NotifyOutcome } from '@/core/application/services/MissionNotificationService';

/**
 * Every action names the yard it is for. runId is optional on the video,
 * complete, and cancel actions on purpose: without one they act on the
 * operator's latest run at this yard, which is what every existing caller
 * means; with one they act on a named attempt, which is what managing
 * concurrent runs needs.
 */
export type OperatorCommand =
  | { action: 'complete'; yardId: string; runId?: string }
  | { action: 'cancel'; yardId: string; runId?: string }
  | { action: 'another-run'; yardId: string }
  | { action: 'attach-video'; yardId: string; url: string; runId?: string }
  | { action: 'remove-video'; yardId: string; runId?: string }
  | { action: 'delete-run'; yardId: string; runId: string }
  | { action: 'resolve'; yardId: string; outcome: ResolveOutcome }
  | { action: 'feedback'; yardId: string; text: string };

/** Who is acting, as recorded on the write, and the yard their session is bound to. */
export interface Operator {
  name: string;
  yardId: string;
}

export type CommandFailure = 'not-found' | 'forbidden' | 'invalid' | 'conflict';

export type CommandResult =
  | { ok: true; missionId: string; status?: MissionStatus; notification?: NotifyOutcome | null }
  | { ok: false; failure: CommandFailure; error: string };

/** Emails the learner. MissionNotificationService, in production. */
export interface LearnerNotifier {
  notifyStatusChange(mission: MissionRecord, status: MissionStatus): Promise<NotifyOutcome>;
}

type BookkeepingCommand = Exclude<OperatorCommand, { action: 'delete-run' }>;

/** A decision, and what the write needs beyond the status change. */
interface Decided {
  decision: Decision;
  youtubeUrl?: string;
  feedback?: string;
  clearsVideo?: boolean;
}

const ANOTHER_YARD = 'That mission is at another yard. Sign out to change yards.';
const ANOTHER_YARDS_RUN = 'That run belongs to another yard.';

function refuse(failure: CommandFailure, error: string): CommandResult {
  return { ok: false, failure, error };
}

export class OperatorMissionCommands {
  constructor(
    private readonly missions: IMissionReader & IMissionBookkeeping,
    private readonly notifier: LearnerNotifier,
    private readonly newRunId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(missionId: string, command: OperatorCommand, operator: Operator): Promise<CommandResult> {
    const record = await this.missions.findById(missionId);
    if (!record || record.deleted) {
      return refuse('not-found', 'Mission not found');
    }

    // A missing run is ordinary, not an error: a yard with no network never
    // flushed one. The entity falls back to the mission's own status and the
    // write creates the run.
    const mission = Mission.restore(record, await this.missions.findRuns(missionId));

    if (command.action === 'delete-run') {
      return this.deleteRun(mission, command, operator);
    }

    const run = mission.latestRunAt(command.yardId);
    const decided = decide(mission, command);
    if (!('decision' in decided)) {
      return decided;
    }

    // A named run has to be one of this yard's own. Without this the runId is
    // an arbitrary document path from the request body, and an operator could
    // attach a video to - or clear one from - another yard's attempt at the
    // same mission.
    if ('runId' in command && command.runId) {
      const named = mission.run(command.runId);
      if (!named) return refuse('not-found', 'Run not found');
      if (named.yardId !== operator.yardId) return refuse('forbidden', ANOTHER_YARDS_RUN);
    }

    if (command.yardId !== operator.yardId) {
      return refuse('forbidden', ANOTHER_YARD);
    }

    const { decision } = decided;
    if (!decision.ok) {
      // A conflict, not a bad request. The request was well formed; the
      // mission simply is not in a state where this makes sense, usually
      // because somebody else got there first.
      return refuse('conflict', decision.error);
    }

    await this.missions.applyBookkeeping(missionId, this.runIdFor(command, run), command.yardId, {
      status: decision.change.status,
      clearsReview: decision.change.clearsReview,
      youtubeUrl: decided.youtubeUrl,
      clearsVideo: decided.clearsVideo ?? false,
      feedback: decided.feedback,
      decidedAt: this.now().toISOString(),
      decidedBy: operator.name,
    });

    return {
      ok: true,
      missionId,
      status: decision.change.status ?? mission.status,
      notification: decision.change.status === 'completed' ? await this.emailLearner(mission) : null,
    };
  }

  /**
   * Delete a mission. The route restricts this to an admin, because
   * the role is a fact about the session; this records who did it.
   *
   * Cancel is the reversible option and stays the answer to "this is not going
   * to run". Delete is for a mission that should not exist at all.
   */
  async deleteMission(missionId: string, admin: Pick<Operator, 'name'>): Promise<CommandResult> {
    const record = await this.missions.findById(missionId);
    if (!record) return refuse('not-found', 'Mission not found');
    if (Mission.restore(record).isDeleted) return refuse('conflict', 'This mission is already deleted');

    await this.missions.softDeleteMission(missionId, this.now().toISOString(), admin.name);
    return { ok: true, missionId };
  }

  /**
   * Removing a run produces no status change, so it does not go through a
   * decision: threading it through applyBookkeeping would mean inventing one.
   *
   * Operator rather than admin, unlike deleting a mission. This is somebody
   * tidying an attempt they logged themselves a minute ago, not erasing a
   * child's work, and the yard checks are what keep it to their own.
   */
  private async deleteRun(
    mission: Mission,
    command: Extract<OperatorCommand, { action: 'delete-run' }>,
    operator: Operator,
  ): Promise<CommandResult> {
    if (command.yardId !== operator.yardId) return refuse('forbidden', ANOTHER_YARD);

    const target = mission.run(command.runId);
    if (!target) return refuse('not-found', 'Run not found');
    if (target.yardId !== command.yardId) return refuse('forbidden', ANOTHER_YARDS_RUN);

    await this.missions.softDeleteRun(mission.id, command.runId, this.now().toISOString(), operator.name);
    return { ok: true, missionId: mission.id };
  }

  /**
   * 'another-run' always takes a fresh id, which is the entire point of it:
   * reusing one would merge the second attempt over the first and destroy the
   * record the action exists to create. Every other action writes to the run
   * it names (if provided), or the latest at this yard, or - for a yard that
   * never flushed a run - a new one the write creates.
   *
   * For actions like 'complete' and 'cancel' that now optionally accept a
   * runId: if one is provided, we use it explicitly. This allows operators to
   * target a specific run when concurrent runs exist at the same yard.
   * If not provided, we fall back to the "latest run" heuristic for backward
   * compatibility.
   */
  private runIdFor(command: BookkeepingCommand, latest: MissionRun | null): string {
    if (command.action === 'another-run') return this.newRunId();
    // For complete, cancel, and other bookkeeping actions: explicit runId takes precedence
    if ('runId' in command && command.runId) return command.runId;
    return latest?.runId ?? this.newRunId();
  }

  /**
   * The learner's email on completion, which once only fired when the YARD
   * marked a mission complete. Without this the same event sends a message or
   * does not depending on which console the operator happened to use, and the
   * child is the one who notices.
   *
   * Best effort, and deliberately after the write: a Resend outage must not
   * roll back a decision the operator already made.
   */
  private async emailLearner(mission: Mission): Promise<NotifyOutcome | null> {
    try {
      return await this.notifier.notifyStatusChange(mission.toRecord(), 'completed');
    } catch (error) {
      console.error('[operator/bookkeeping] notification failed:', error);
      return null;
    }
  }
}

/** The entity's decision for each action, plus what the write needs alongside it. */
function decide(mission: Mission, command: BookkeepingCommand): Decided | CommandResult {
  const { yardId } = command;
  switch (command.action) {
    case 'complete':
      return { decision: mission.complete(yardId) };
    case 'cancel':
      return { decision: mission.cancel(yardId) };
    case 'another-run':
      return { decision: mission.logAnotherRun(yardId) };
    case 'attach-video':
      // Parsed rather than pattern-matched, with the same helper the learner's
      // player uses. If the id cannot be read out of the link, the mission page
      // could not embed it either, so accepting it would store a link that
      // renders as an empty frame.
      return getYouTubeId(command.url)
        ? { decision: mission.attachVideo(yardId), youtubeUrl: command.url }
        : refuse('invalid', 'Use a youtube.com/watch?v=... or youtu.be/... link.');
    case 'remove-video':
      return { decision: mission.removeVideo(yardId), clearsVideo: true };
    case 'resolve':
      return { decision: mission.resolve(yardId, command.outcome) };
    case 'feedback':
      return { decision: mission.leaveFeedback(yardId), feedback: command.text };
  }
}
