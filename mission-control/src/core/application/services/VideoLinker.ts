/**
 * Attaching a video to the run it shows, and closing the run with it.
 *
 * Two things find a run's video. The scheduled linker reads the channel's
 * recent uploads and lets each one name its mission. An automatic upload
 * knows its video the moment YouTube accepts it. They must reach the same
 * answer by the same rule, so the rule is here and both call it: which run a
 * video belongs to (services/youtubeLinking.planVideoLink), one write that
 * attaches it and settles the run, and the learner's email when that write
 * completed the mission.
 *
 * WHY AN UPLOAD DOES NOT WAIT FOR THE LINKER. The linker reads the channel
 * with an API key, and an API key cannot see a private video. Automatic
 * uploads are private unless an admin chooses otherwise, so the linker never
 * found one: the video id sat in the upload ledger, which only operators
 * read, and the learner's page never showed it.
 *
 * This lived in the cron route, with the repository and the notifier pulled
 * from the container inside it. Here it takes them, as OperatorMissionCommands
 * does, so the second caller did not mean a second copy.
 */

import type { MissionRecord } from '@/core/domain/entities/Mission';
import type {
  IMissionBookkeeping,
  IMissionReader,
} from '@/core/domain/repositories/IMissionRepository';
import {
  planVideoLink,
  watchUrl,
  type ClaimedVideo,
} from '@/core/domain/services/youtubeLinking';
import type { LearnerNotifier } from '@/core/application/services/OperatorMissionCommands';

export type VideoLinkResult =
  | {
      kind: 'linked';
      runId: string;
      /** The write closed the run as well as attaching the video. */
      completed: boolean;
      /** The completion email could not be sent. The write stands regardless. */
      emailFailed: boolean;
    }
  | { kind: 'skipped'; reason: string };

export class VideoLinker {
  constructor(
    private readonly missions: Pick<IMissionReader, 'findRuns' | 'findById'>
      & Pick<IMissionBookkeeping, 'applyBookkeeping'>,
    private readonly notifier: LearnerNotifier,
    private readonly newRunId: () => string,
  ) {}

  /** `decidedBy` names the path on the write, so a run says what closed it. */
  async link(claim: ClaimedVideo, decidedBy: string): Promise<VideoLinkResult> {
    const runs = await this.missions.findRuns(claim.missionId);

    // Planned from the runs first, which is all an ordinary poll needs. The
    // mission is read only when the video is about to complete it, or there
    // is no run to go on: once per mission, not once per poll.
    let plan = planVideoLink(claim, runs, undefined);
    let mission: MissionRecord | null = null;
    if (plan.kind === 'needs-mission' || (plan.kind === 'link' && plan.completes)) {
      mission = await this.missions.findById(claim.missionId);
      if (mission?.deleted) mission = null;
      plan = planVideoLink(claim, runs, mission);
    }
    if (plan.kind !== 'link') {
      return { kind: 'skipped', reason: plan.kind === 'skip' ? plan.reason : 'nothing to link' };
    }

    const runId = plan.runId ?? this.newRunId();
    await this.missions.applyBookkeeping(claim.missionId, runId, plan.yardId, {
      status: plan.completes ? 'completed' : null,
      // Completing settles a review, as an operator's completion does: a
      // video of the run answers the question the flag was asking.
      clearsReview: plan.completes,
      youtubeUrl: watchUrl(claim.videoId),
      decidedAt: new Date().toISOString(),
      decidedBy,
    });

    // The same email an operator's completion sends. Best effort and after
    // the write: a mail outage must not undo a mission the video closed.
    let emailFailed = false;
    if (plan.completes && mission) {
      try {
        await this.notifier.notifyStatusChange(mission, 'completed');
      } catch {
        emailFailed = true;
      }
    }
    return { kind: 'linked', runId, completed: plan.completes, emailFailed };
  }
}
