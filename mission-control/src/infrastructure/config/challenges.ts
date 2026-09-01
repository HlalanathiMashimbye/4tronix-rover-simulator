/**
 * Progressive Challenges content.
 *
 * Developer-authored, not learner-editable or Firestore-backed - the same
 * "static seed a service reads" role infrastructure/config/yards.ts plays for
 * yard data. Typed against core/domain/entities/Challenge.ts; a learner's
 * progress THROUGH this content is separate (see ChallengeProgress and
 * FirestoreChallengeProgressRepository).
 *
 * Level 3's summary describes reading the sensor rather than acting on it:
 * the rover's Blockly toolbox (lib/roverBlockly.ts) has no comparison or
 * conditional blocks, and its distance reporter block has nowhere to plug
 * in, so "read the sensor and decide" is not a program this platform can
 * express yet. What IS real: pointing the mast and reading the distance
 * sensor, which is what this challenge teaches.
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
    description: "Point the mast and read the rover's distance sensor.",
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
    summary: 'Drive the rover forward and spin it, then run the simulator to watch it go.',
    workspaceKind: 'blockly-sim',
    steps: [
      {
        id: 'drive-forward',
        title: 'Drive forward',
        instructions:
          'From the Movement category, drag a "Move Forward" block onto the canvas and snap it under the uplink block. Press Run to simulate it.',
        hints: ['The uplink block ("When mission received") is already on the canvas - blocks snap underneath it, not beside it.'],
        checks: [{ kind: 'trajectory-outcome', outcome: 'moved-forward' }],
      },
      {
        id: 'spin-right',
        title: 'Add a turn',
        instructions: 'Snap a "Spin Right" block on underneath, then press Run again.',
        checks: [{ kind: 'trajectory-outcome', outcome: 'spun-right' }],
      },
      {
        id: 'export',
        title: 'Send it to a real rover',
        instructions: 'Happy with your mission? Press "Finish & Export" to carry it into Create Mission.',
        checks: [],
      },
    ],
  },

  'loop-structures': {
    id: 'loop-structures',
    levelId: 2,
    title: 'Loop Structures & Repeat Logic',
    summary: 'Use a Repeat block to drive a pattern without stacking the same blocks by hand.',
    workspaceKind: 'blockly-sim',
    steps: [
      {
        id: 'add-repeat',
        title: 'Use a Repeat block',
        instructions:
          'From the Control category, drag a "Repeat" block onto the canvas and set it to repeat 4 times.',
        checks: [{ kind: 'code-contains', pattern: 'for _ in range(' }],
      },
      {
        id: 'drive-inside-loop',
        title: 'Drive inside the loop',
        instructions:
          'Place a "Move Forward" block and a "Spin Right" block INSIDE the repeat block, then press Run - the rover should trace a shape instead of a straight line.',
        hints: ['Drop the driving blocks into the notch inside the Repeat block, not underneath it.'],
        checks: [
          { kind: 'trajectory-outcome', outcome: 'moved-forward' },
          { kind: 'trajectory-outcome', outcome: 'spun-right' },
        ],
      },
      {
        id: 'export',
        title: 'Send it to a real rover',
        instructions: 'Happy with your mission? Press "Finish & Export" to carry it into Create Mission.',
        checks: [],
      },
    ],
  },

  'sensor-operations': {
    id: 'sensor-operations',
    levelId: 3,
    title: 'Advanced Sensor Operations',
    summary: "Point the mast and read the rover's distance sensor.",
    workspaceKind: 'blockly-sim',
    steps: [
      {
        id: 'point-mast',
        title: 'Point the mast',
        instructions:
          'From the Mast category, drag a "Point Mast" block onto the canvas and aim it forward (centre).',
        checks: [{ kind: 'code-contains', pattern: 'rover.setServo(0,' }],
      },
      {
        id: 'read-distance',
        title: 'Read the distance sensor',
        instructions:
          'Add a "Read Distance" block after it. This measures how far away the nearest thing is and prints it to the console.',
        hints: ["The distance sensor sits on the mast, so it reads whatever the mast is currently pointed at."],
        checks: [{ kind: 'code-contains', pattern: 'rover.getDistance()' }],
      },
      {
        id: 'export',
        title: 'Send it to a real rover',
        instructions: 'Happy with your mission? Press "Finish & Export" to carry it into Create Mission.',
        checks: [],
      },
    ],
  },
};
