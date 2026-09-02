/**
 * Progressive Challenges content.
 *
 * Developer-authored, not learner-editable or Firestore-backed - the same
 * "static seed a service reads" role infrastructure/config/yards.ts plays for
 * yard data. Typed against core/domain/entities/Challenge.ts; a learner's
 * progress THROUGH this content is separate (see ChallengeProgress and
 * FirestoreChallengeProgressRepository).
 *
 * Level 2 is Blockly (workspaceKind: 'blockly-sim'); Level 3 is real Python in
 * Monaco (workspaceKind: 'monaco-sim'), not Blockly - the rover's Blockly
 * toolbox (lib/roverBlockly.ts) has no comparison or conditional blocks, and
 * its distance reporter block has nowhere to plug in, so "read the sensor and
 * decide" cannot be built out of blocks on this platform. Real Python has
 * if/else, so that is what Level 3 teaches with.
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
    description: 'Build a rover mission out of blocks: Jezero Crater waypoint navigation.',
    challengeIds: ['basic-movement', 'loop-structures'],
  },
  {
    id: 3,
    title: 'Autonomous Hazard Avoidance',
    description: 'Write real Python that reads the distance sensor and decides what to do.',
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
          'The mission feed can be narrowed to just the missions still waiting to run. On a phone, tap the labelled "Pending" chip above the feed. On a wider screen, the same filters live as small icons inside the search bar at the top of the page - hover one to see its name, and click the hourglass icon for Pending.',
        hints: [
          'On a phone: the filter chips sit just above the mission grid, next to "All missions".',
          'On a wider screen: look inside the search field itself, at the top of the page - the icons overlaid on its right edge are the filters.',
        ],
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
    summary: 'Navigate a waypoint at Jezero Crater: drive forward and turn using blocks.',
    workspaceKind: 'blockly-sim',
    standards: {
      capsPhase: 'GET',
      capsSubject: 'Coding & Robotics: directional commands and speed variables',
      csta: ['1B-AP-08'],
      nasaJplContext: 'Jezero Crater Waypoint Navigation: drive the rover to a marked survey point.',
    },
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
    summary: 'Survey a grid at Jezero Crater using a Repeat block instead of stacking blocks by hand.',
    workspaceKind: 'blockly-sim',
    standards: {
      capsPhase: 'GET',
      capsSubject: 'Coding & Robotics: loop controls and repeating structures',
      csta: ['2-AP-12'],
      nasaJplContext: 'Jezero Crater Grid Surface Survey: repeat one movement pattern to cover an area.',
    },
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
    title: 'Autonomous Hazard Avoidance',
    summary: "Read the rover's distance sensor and write an if/else that reacts to what it finds.",
    workspaceKind: 'monaco-sim',
    standards: {
      capsPhase: 'FET',
      capsSubject: 'Information Technology: control structures and conditional decision-making',
      csta: ['2-AP-10', '3A-AP-16'],
      nasaJplContext: 'AutoNav: decide the next move from live sensor telemetry instead of a fixed script.',
    },
    steps: [
      {
        id: 'read-distance',
        title: 'Read the distance sensor',
        instructions:
          'Call rover.getDistance() and store it in a variable, then print it so you can see what the sensor reports before you act on it.',
        hints: ['Try: distance = rover.getDistance()  followed by  print(distance)'],
        checks: [{ kind: 'code-contains', pattern: 'rover.getDistance()' }],
      },
      {
        id: 'decide',
        title: 'Decide what to do about it',
        instructions:
          "Write an if/else: if the distance is small (something is close), turn away from it; otherwise, keep driving forward. This is the same shape as the rover's own AutoNav logic - read a sensor, then branch on what it says.",
        hints: [
          'An if needs a colon at the end of its line, and the lines under it must be indented.',
          'Example shape: if distance < 20:\n    rover.spinRight(60)\nelse:\n    rover.forward(60)',
        ],
        checks: [
          { kind: 'code-contains', pattern: 'if ' },
          { kind: 'code-contains', pattern: 'else:' },
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
};
