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

export interface Learner {
  // Identifiers
  id: string;                        // Unique learner ID (nanoid)
  sessionId: string;                 // Browser fingerprint for device linking

  // Optional profile (user-provided, not required)
  // Read-only now, and absent on every record. Nothing can set it: the writer
  // and its sanitiser were removed because no screen ever offered a learner a
  // way to name themselves, and a dormant one is what gets wired to a "name
  // yourself" box without anyone weighing what it undoes. Learners are
  // anonymous here by design. MissionNotificationService still reads this when
  // personalising a completion email to the learner's own address, and handles
  // it being absent.
  displayName?: string;
  avatarColor?: string;              // Random color for UI personalization
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

/**
 * Creates a new anonymous learner with default values
 */
export function createAnonymousLearner(sessionId: string): Learner {
  const now = new Date().toISOString();

  return {
    id: sessionId, // Use sessionId as the learner ID for simplicity
    sessionId,
    avatarColor: generateRandomColor(),
    missionCount: 0,
    completedMissions: 0,
    createdAt: now,
    lastActiveAt: now,
    devices: [
      {
        sessionId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ],
  };
}

/**
 * Generates a random avatar color for visual personalization
 */
function generateRandomColor(): string {
  const colors = [
    '#EF4444', // red
    '#F59E0B', // amber
    '#10B981', // emerald
    '#3B82F6', // blue
    '#8B5CF6', // violet
    '#EC4899', // pink
    '#06B6D4', // cyan
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Type guard to check if learner has completed any missions
 */
export function isActiveLearner(learner: Learner): boolean {
  return learner.missionCount > 0;
}

