import { MissionStatus } from '@/core/domain/entities/Mission';
import { MissionState, type LearnerFacingStatus } from '@/core/domain/entities/MissionState';

/**
 * Discovery status: the simplified, learner-facing view of a mission's lifecycle
 * used by the public feed and the mission detail page.
 *
 * Intentionally only Completed or Pending: a learner should not be made to feel
 * bad by seeing their own mission marked "Failed", so anything not completed
 * (queued / processing / failed / cancelled) reads as "Pending". The operator
 * console shows the full, accurate status instead.
 */
export type DiscoveryStatus = LearnerFacingStatus;

export function getDiscoveryStatus(status: MissionStatus): DiscoveryStatus {
  return MissionState.of(status).learnerFacing();
}
