/**
 * Learner Domain Entity
 *
 * Represents an anonymous learner in the system.
 * No email or password required - identified via browser fingerprint.
 *
 * Design principles:
 * - Privacy-first: No PII collected
 * - Session-based: Uses nanoid for unique identification
 * - Progressive enhancement: Can be upgraded to authenticated user later
 */

import { ChallengeProgress } from './ChallengeProgress';

export interface LearnerAvatar {
  style: string;
  seed: string;
}

export const AVATAR_STYLES = ['bottts', 'identicon', 'shapes'] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export interface Learner {
  // Identifiers
  id: string;                        // Unique learner ID (nanoid)
  sessionId: string;                 // Browser fingerprint for device linking

  // Profile — set during the welcome flow, changeable later.
  displayName?: string;
  avatar?: LearnerAvatar;
  learnerEmail?: string;             // Optional email for notifications / reminders

  // Activity tracking (missions)
  missionCount: number;              // Total missions submitted
  completedMissions: number;         // Successfully completed missions

  // Timestamps
  createdAt: string;                 // When learner first accessed system
  lastActiveAt: string;              // Last activity timestamp

  // Device info (for multi-device detection)
  devices: LearnerDevice[];

  // Progressive Challenges advancement. Absent until a learner completes
  // their first challenge - same as displayName, there is no eager default.
  // firestore.rules already allowlisted this field on the learner document
  // ahead of this feature; this is the entity catching up to that.
  progress?: ChallengeProgress;
}

export interface LearnerDevice {
  sessionId: string;                 // Unique session identifier
  firstSeenAt: string;               // When this device was first seen
  lastSeenAt: string;                // Last activity on this device
  deviceFingerprint?: string;        // Optional browser fingerprint hash
}

export function createAnonymousLearner(learnerId: string): Learner {
  const now = new Date().toISOString();

  return {
    id: learnerId,
    sessionId: learnerId,
    avatar: undefined,
    missionCount: 0,
    completedMissions: 0,
    createdAt: now,
    lastActiveAt: now,
    devices: [
      {
        sessionId: learnerId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ],
  };
}


/**
 * Type guard to check if learner has completed any missions
 */
export function isActiveLearner(learner: Learner): boolean {
  return learner.missionCount > 0;
}

