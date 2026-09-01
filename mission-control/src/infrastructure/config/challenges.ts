/**
 * Progressive Challenges content.
 *
 * Developer-authored, not learner-editable or Firestore-backed - the same
 * "static seed a service reads" role infrastructure/config/yards.ts plays for
 * yard data. Typed against core/domain/entities/Challenge.ts; a learner's
 * progress THROUGH this content is separate (see ChallengeProgress and
 * FirestoreChallengeProgressRepository).
 *
 * Level 2/3 challenges below are scaffolded with real titles/summaries but
 * empty step lists - their full step-by-step content lands with the Blockly
 * workspace that can actually run them (see docs/plans, Phase D).
 */

import { Challenge, ChallengeId, ChallengeLevel } from '@/core/domain/entities/Challenge';

export const CHALLENGE_LEVELS: ChallengeLevel[] = [
  {
    id: 1,
    title: 'Site Navigation',
    description: 'Learn how to find missions on the platform.',
    challengeIds: ['platform-orientation'],
  },
  {
    id: 2,
    title: 'Blockly Rover Commands',
    description: 'Build a rover mission out of blocks.',
    challengeIds: ['basic-movement', 'loop-structures'],
  },
  {
    id: 3,
    title: 'Advanced Sensor Operations',
    description: "Use the rover's distance sensor to make decisions.",
    challengeIds: ['sensor-operations'],
  },
];

export const CHALLENGES: Record<ChallengeId, Challenge> = {
  'platform-orientation': {
    id: 'platform-orientation',
    levelId: 1,
    title: 'Platform Orientation',
    summary: 'Search missions, filter by status, and browse the full feed.',
    workspaceKind: 'embedded-platform',
    steps: [
      {
        id: 'filter-pending',
        title: 'Filter by status',
        instructions:
          'The mission feed can be narrowed to just the missions still waiting to run. Click the "Pending" filter above the feed.',
        hints: ['The filter chips sit just above the mission grid, next to "All missions".'],
        checks: [{ kind: 'search-filter', filterKey: 'Pending' }],
      },
      {
        id: 'search-missions',
        title: 'Search for a mission',
        instructions: 'Type anything into the search box to narrow the feed by name or code.',
        hints: ['The search box is in the navigation bar - on a phone, at the top of the feed instead.'],
        checks: [{ kind: 'search-query' }],
      },
      {
        id: 'load-more',
        title: 'Browse further',
        instructions:
          'Clear your filters, then load an older page of missions with the "Show more missions" button at the bottom of the feed.',
        checks: [{ kind: 'load-more' }],
      },
    ],
  },

  'basic-movement': {
    id: 'basic-movement',
    levelId: 2,
    title: 'Basic Rover Movement',
    summary: 'Drive the rover forward, back, and spin it left or right using blocks.',
    workspaceKind: 'blockly-sim',
    steps: [],
  },

  'loop-structures': {
    id: 'loop-structures',
    levelId: 2,
    title: 'Loop Structures & Repeat Logic',
    summary: 'Use a repeat block to drive a pattern without stacking the same blocks by hand.',
    workspaceKind: 'blockly-sim',
    steps: [],
  },

  'sensor-operations': {
    id: 'sensor-operations',
    levelId: 3,
    title: 'Advanced Sensor Operations',
    summary: "Read the rover's distance sensor and act on what it sees.",
    workspaceKind: 'blockly-sim',
    steps: [],
  },
};
