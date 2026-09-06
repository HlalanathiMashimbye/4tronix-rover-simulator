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
 * Monaco (workspaceKind: 'monaco-sim'). Level 3 deliberately asks for a shape
 * the learner has already traced with blocks, so the new thing is the typing,
 * not the task.
 *
 * WHY PLACE NAMES ARE EXPLAINED HERE AND STANDARDS CODES ARE NOT.
 * Challenges used to carry CAPS/CSTA codes, rendered as pills on the learner's
 * instruction panel. They came out because nobody on the team can vouch for the
 * mapping, and a curriculum claim a teacher can check is only worth making if
 * it survives being checked. "Jezero Crater" got the opposite treatment - it
 * stayed, with a sentence saying what it is, because an unexplained proper noun
 * is a question a learner cannot answer, while a real place is a hook.
 *
 * Step instructions carry their code as their own \n-separated lines rather
 * than inline in a sentence. That is a learner-facing choice - code you are
 * meant to type should look like code - and it is also what lets
 * __tests__/unit/challengeContent.test.ts lift the program back out and prove
 * the step's own checks accept what the step teaches.
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
    // Jezero is explained here, once, rather than repeated into each challenge
    // summary below - the level is the smallest place that covers both of them.
    description:
      "Build rover missions out of blocks at Jezero Crater - the dried-up river delta on Mars where NASA's Perseverance rover landed in 2021.",
    challengeIds: ['basic-movement', 'loop-structures'],
  },
  {
    id: 3,
    title: 'Python Rover Commands',
    description: 'Leave the blocks behind and type the same missions out as real Python.',
    challengeIds: ['draw-a-square'],
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
          'Clear BOTH your search text (the X in the search box) and your status filter (click back to "All missions"), then load an older page with the "Show more missions" button at the bottom of the feed. That button only appears once nothing is narrowing the view. If it still doesn\'t appear, there is nothing further to load - you\'re already looking at every mission, so this step is done.',
        hints: [
          'The button is deliberately hidden while a search or filter is active, so you never see "load more" on a list that is already the whole result.',
        ],
        checks: [{ kind: 'load-more' }],
      },
    ],
  },

  'basic-movement': {
    id: 'basic-movement',
    levelId: 2,
    title: 'Basic Rover Movement',
    summary: 'Drive to a survey waypoint: move forward and turn using blocks.',
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
    summary: 'Survey a grid using a Repeat block instead of stacking blocks by hand.',
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

  /**
   * Level 3 is a square rather than the autonomous hazard-avoidance challenge
   * that used to sit here. That one asked a learner to read the distance sensor
   * and branch on it, which the rover cannot yet do and the simulator does not
   * model - it scored them on a promise the platform could not keep. A square
   * is the shape Level 2 already traces with blocks, so the step up to Monaco
   * is the typing and nothing else.
   *
   * The API is speed-then-duration (rover.forward(60) then time.sleep(2)), not
   * degrees - see lib/parseRoverCode.ts. There is deliberately no "turn 90
   * degrees" command to hand the learner, so the corner sleep is theirs to tune
   * by running it and looking, which is the point.
   */
  'draw-a-square': {
    id: 'draw-a-square',
    levelId: 3,
    title: 'Draw a Square',
    summary: 'Type real Python that drives the rover around a square - one side, one corner, four times.',
    workspaceKind: 'monaco-sim',
    steps: [
      {
        id: 'drive-one-side',
        title: 'Drive one side',
        instructions:
          'The rover API is speed first, then how long to hold it. Type:\n\nrover.forward(60)\ntime.sleep(2)\nrover.stop()\n\nPress Run. That straight line is one side of your square.',
        hints: [
          'Speeds are a percentage of full power, so 0-100. The sleep is in seconds.',
          'rover.stop() at the end matters - without it the rover keeps running its last command.',
        ],
        checks: [{ kind: 'trajectory-outcome', outcome: 'moved-forward' }],
      },
      {
        id: 'turn-a-corner',
        title: 'Turn a corner',
        instructions:
          'Turning uses the same shape: a spin command, then a sleep saying how long to spin for. Add these two lines after your first side, then Run and watch the corner:\n\nrover.spinRight(60)\ntime.sleep(2)\n\nThere is no "turn 90 degrees" command - you choose the sleep. Adjust 2 up or down until the corner looks square.',
        hints: [
          'Too long and the rover over-turns; too short and the corner is shallow. Change one number, Run, look.',
          'A quarter turn at speed 60 takes about 2 seconds - see spinSecondsForDegrees in lib/rover-physics.ts.',
        ],
        checks: [{ kind: 'trajectory-outcome', outcome: 'spun-right' }],
      },
      {
        id: 'repeat-four-times',
        title: 'Four sides, four corners',
        instructions:
          'A square is one side and one corner, done four times. Wrap what you have in a loop:\n\nfor _ in range(4):\n    rover.forward(60)\n    time.sleep(2)\n    rover.spinRight(60)\n    time.sleep(2)\n\nrover.stop()\n\nEverything inside the loop must be indented by four spaces. Press Run - the rover should end up roughly back where it started.',
        hints: [
          'This is the same Repeat block from Level 2, written out by hand.',
          'If the shape does not close, your corner sleep is off - tune it and Run again.',
        ],
        checks: [
          { kind: 'code-contains', pattern: 'for _ in range(' },
          { kind: 'trajectory-outcome', outcome: 'moved-forward' },
          { kind: 'trajectory-outcome', outcome: 'spun-right' },
        ],
      },
      {
        id: 'export',
        title: 'Send it to a real rover',
        instructions: 'Happy with your square? Press "Finish & Export" to carry it into Create Mission.',
        checks: [],
      },
    ],
  },
};
