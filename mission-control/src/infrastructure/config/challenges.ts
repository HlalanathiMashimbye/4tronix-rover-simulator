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
 * WHY STANDARDS LIVE ON A LEVEL'S OUTCOMES, WITH THEIR WORDING.
 * Challenges used to carry bare CAPS/CSTA codes as pills on the instruction
 * panel. They came out because nobody on the team could vouch for the mapping,
 * and a curriculum claim a teacher can check is only worth making if it
 * survives being checked. They are back (AB#444) in a shape that can be
 * checked: each level states 2-4 "You will be able to ..." outcomes, each
 * outcome cites its standard, and the hub shows the standard's full CSTA
 * wording and grade band (curriculumStandards.ts) beside it - so the claim is
 * made to the person able to check it. Every challenge names the outcomes it
 * practises in outcomeIds; core/domain/services/curriculumOutcomes.ts holds
 * the rules. "Jezero Crater" is explained in the level description for the
 * same reason: an unexplained proper noun is a question a learner cannot
 * answer, while a real place is a hook.
 *
 * Step instructions carry their code as their own \n-separated lines rather
 * than inline in a sentence. That is a learner-facing choice - code you are
 * meant to type should look like code - and it is also what lets
 * __tests__/unit/challengeContent.test.ts lift the program back out and prove
 * the step's own checks accept what the step teaches.
 *
 * LEADERBOARD SCORING: scorePoints must match the values in
 * core/domain/services/scoreCalculation.ts CHALLENGE_POINTS to ensure
 * leaderboard scoring is consistent. These are registered once per platform
 * and do not change per-learner.
 */

import { Challenge, ChallengeId, ChallengeLevel } from '@/core/domain/entities/Challenge';
import { spinSecondsForDegrees } from '@/lib/rover-physics';

export const CHALLENGE_LEVELS: ChallengeLevel[] = [
  {
    id: 1,
    title: 'Getting Started',
    description: 'Find your way around, see what else is here, and send your first mission.',
    // Three small challenges rather than one. A learner who finishes the feed
    // tour has not seen History, the leaderboard, or Create Mission - the
    // level used to declare the platform learnt on the strength of a search
    // box - and a single long challenge pays out once, at the end, which is
    // where people give up.
    challengeIds: ['platform-orientation', 'explore-the-platform', 'first-mission'],
    outcomes: [
      {
        id: 'l1-find',
        text: 'You will be able to find what you are looking for on a website by searching, filtering and browsing.',
        alignment: { csta: ['1A-CS-01'] },
      },
      {
        id: 'l1-privacy',
        text: 'You will be able to choose what you share about yourself online, and say why some things are kept private.',
        alignment: { csta: ['1B-NI-05'] },
      },
      {
        id: 'l1-uplink',
        text: 'You will be able to send a program from your computer to a real rover, and find out when it has run.',
        alignment: {
          nasaJpl:
            "Perseverance's team writes the rover's commands on Earth, sends them to Mars, and waits for the rover to report back - it is never driven live.",
        },
      },
    ],
  },
  {
    id: 2,
    title: 'Blockly Rover Commands',
    // Jezero is explained here, once, rather than repeated into each challenge
    // summary below - the level is the smallest place that covers both of them.
    description:
      "Build rover missions out of blocks at Jezero Crater - the dried-up river delta on Mars where NASA's Perseverance rover landed in 2021.",
    // drive-to-target first: one straight move and no turning, so the first
    // thing a learner does with blocks is read some and change one number
    // (AB#453), before basic-movement asks them to build from nothing.
    challengeIds: ['drive-to-target', 'basic-movement', 'loop-structures'],
    outcomes: [
      {
        id: 'l2-sequence',
        text: 'You will be able to put movement commands in the right order to drive the rover where you want it to go.',
        alignment: {
          csta: ['1B-AP-10'],
          nasaJpl: "Rover drivers at NASA JPL plan each of Perseverance's drives across Jezero Crater as a sequence of commands.",
          caps: 'Coding and Robotics (Grades R-9): algorithms and sequencing',
        },
      },
      {
        id: 'l2-repeat',
        text: 'You will be able to use a Repeat block so the rover does the same thing several times, without copying blocks.',
        alignment: {
          csta: ['1B-AP-10'],
          caps: 'Coding and Robotics (Grades R-9): loops',
        },
      },
      {
        id: 'l2-debug',
        text: 'You will be able to run your program in the simulator, see what went wrong, and fix it.',
        alignment: {
          csta: ['1B-AP-15'],
          nasaJpl: 'JPL tests every drive on a simulated rover before sending it to Mars.',
        },
      },
    ],
  },
  {
    id: 3,
    title: 'Python Rover Commands',
    description: 'Leave the blocks behind and type the same missions out as real Python.',
    challengeIds: ['draw-a-square'],
    outcomes: [
      {
        id: 'l3-python',
        text: 'You will be able to type a short Python program that drives the rover, giving each move a speed and a time.',
        alignment: { csta: ['1B-AP-10'] },
      },
      {
        id: 'l3-decompose',
        text: 'You will be able to break a shape into parts that repeat - one side and one corner, four times - and write it as a loop.',
        alignment: { csta: ['1B-AP-11'] },
      },
      {
        id: 'l3-tune',
        text: 'You will be able to change one number at a time and re-run your program until the rover does what you meant.',
        alignment: { csta: ['2-AP-17'] },
      },
    ],
  },
];

export const CHALLENGES: Record<ChallengeId, Challenge> = {
  'platform-orientation': {
    id: 'platform-orientation',
    levelId: 1,
    title: 'Find Your Way Around',
    summary: 'Search missions, filter by status, and browse the full feed.',
    workspaceKind: 'embedded-platform',
    scorePoints: 50,
    outcomeIds: ['l1-find'],
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

  /**
   * Everything this challenge asks for happens on ANOTHER page, so its checks
   * read platformMilestones rather than anything live in the workspace. A
   * learner leaves, looks, and comes back to find the step already ticked -
   * which is also why the steps are few and independent: returning remounts
   * the workspace at step one, and a long sequence would be tedious to walk
   * back through. See ChallengeWorkspace's milestone read.
   */
  'explore-the-platform': {
    id: 'explore-the-platform',
    levelId: 1,
    title: 'Explore the Platform',
    summary: 'There is more here than the mission feed - go and find it.',
    workspaceKind: 'embedded-platform',
    scorePoints: 75,
    outcomeIds: ['l1-find', 'l1-privacy'],
    steps: [
      {
        id: 'visit-history',
        title: 'Find your mission history',
        instructions:
          'Every mission you send is kept, with the video of your code driving the rover. Open History from the navigation bar to see yours, then come back here - this step ticks itself once you have been.',
        hints: [
          'On a phone the navigation lives in the bar along the bottom of the screen.',
          'It will be empty if you have not sent a mission yet. That is the next challenge.',
        ],
        checks: [{ kind: 'route-visited', path: '/history' }],
      },
      {
        id: 'visit-leaderboard',
        title: 'Check the leaderboard',
        instructions:
          'The leaderboard shows how other people are doing on the challenges. Open Leaderboard from the navigation bar, then come back. Joining it is your choice - there is a setting on that page, and you are not on it unless you say so.',
        hints: ['Nothing about you appears there until you opt in on that page.'],
        checks: [{ kind: 'route-visited', path: '/leaderboard' }],
      },
    ],
  },

  'first-mission': {
    id: 'first-mission',
    levelId: 1,
    title: 'Create Your First Mission',
    summary: 'Name a mission, send it to the queue, and find out how you get told when it runs.',
    workspaceKind: 'embedded-platform',
    scorePoints: 100,
    outcomeIds: ['l1-privacy', 'l1-uplink'],
    steps: [
      {
        id: 'open-create-mission',
        title: 'Open Create Mission',
        instructions:
          'Open Create Mission from the navigation bar. Your mission already has a name - something like "Jolly Crater Rover" - picked for you from a fixed list of words. You cannot type your own, and there is a button to roll a different one if you do not like it. Have a look, then come back.',
        hints: [
          'Names come from a word list rather than a text box so that nothing a stranger typed can appear on a page other children read.',
        ],
        checks: [{ kind: 'route-visited', path: '/mission' }],
      },
      {
        id: 'send-a-mission',
        title: 'Send it to the queue',
        instructions:
          'Now write a short mission - a couple of movement blocks is plenty - press Run to watch it in the simulator, then send it to the queue. Your work stays in the editor if you wander off and come back, so you cannot lose it by accident. After you send it you will be asked for an email address: that is optional, and it is how you get told when a real rover has run your code and the video is ready.',
        hints: [
          'The send button only wakes up once you have simulated the code you are about to send.',
          'No email means no notification, not a rejected mission - you would just check History yourself.',
        ],
        checks: [{ kind: 'mission-created' }],
      },
    ],
  },

  /**
   * PRIMM (Predict, Run, Investigate, Modify, Make), suggested by the sponsor
   * as mission 1 (AB#453). The learner starts with code they did not write and
   * reads it before running it, rather than facing an empty canvas.
   *
   * No turning anywhere: the starter and the target are one straight move, so
   * the only thing to work out is how long to drive.
   *
   * The target is a marker straight ahead of the start mark rather than a
   * rock: the start (AB#465) is mid-seam facing the front wall, and no rock
   * lies ahead of it. At the measured 9cm a second at speed 60, the starter's
   * 3 seconds stops about 18cm short of the 5-second target, and the
   * Move Forward block's half-second steps put 4.5, 5 and 5.5 seconds inside
   * the ring - challengeTarget.test.ts holds both numbers to that.
   */
  'drive-to-target': {
    id: 'drive-to-target',
    levelId: 2,
    title: 'Drive to the Target',
    summary: 'Read some ready-made blocks, guess what they do, then change one number until the rover stops on the target.',
    workspaceKind: 'blockly-sim',
    scorePoints: 125,
    outcomeIds: ['l2-sequence', 'l2-debug'],
    starterBlocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'rover_on_receive',
            x: 40,
            y: 40,
            inputs: { DO: { block: { type: 'rover_forward', fields: { TIME: 3 } } } },
          },
        ],
      },
    },
    target: {
      description: 'One straight line, forward to the target. No turns.',
      commands: [{ command: 'forward', speed: 60, duration: 5 }],
      arriveWithinCm: 5,
    },
    steps: [
      {
        id: 'predict',
        title: 'Predict',
        instructions:
          'Some blocks are already on the canvas. Do not run them yet! Read them, then pick what you think the rover will do.',
        prediction: {
          question: 'What will the rover do?',
          options: ['Drive in a square', 'Drive in a triangle', 'Drive in a straight line', 'Spin on the spot'],
        },
        checks: [{ kind: 'prediction-made' }],
      },
      {
        id: 'run',
        title: 'Run',
        instructions: 'Press Run and watch the rover. Did it do what you guessed? Whatever you picked, you know something new now.',
        checks: [{ kind: 'trajectory-outcome', outcome: 'moved-forward' }],
      },
      {
        id: 'modify',
        title: 'Reach the target',
        instructions:
          'The rover stopped before the target. Which number decides how far it goes? Change it, press Run, and look. Keep going until the rover stops inside the target.',
        hints: [
          'The number in the Move Forward block is how many seconds the rover drives for.',
          'More seconds means further. If it goes past the target, try a smaller number.',
        ],
        checks: [{ kind: 'reaches-target' }],
      },
      {
        id: 'export',
        title: 'Send it to a real rover',
        instructions: 'You did it! Press "Finish & Export" to carry your blocks into Create Mission and send them to the real rover.',
        checks: [],
      },
    ],
  },

  'basic-movement': {
    id: 'basic-movement',
    levelId: 2,
    title: 'Basic Rover Movement',
    summary: 'Drive to a survey waypoint: move forward and turn using blocks.',
    workspaceKind: 'blockly-sim',
    scorePoints: 150,
    outcomeIds: ['l2-sequence', 'l2-debug'],
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
    scorePoints: 200,
    outcomeIds: ['l2-repeat', 'l2-debug'],
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
    scorePoints: 250,
    outcomeIds: ['l3-python', 'l3-decompose', 'l3-tune'],
    // The square the final step's loop draws, with its corners turned exactly
    // 90 degrees: the shape to aim for, not the sleeps that make it (AB#447).
    target: {
      description: 'Four equal sides and four square corners, ending back where it started.',
      commands: Array.from({ length: 4 }, () => [
        { command: 'forward', speed: 60, duration: 2 },
        { command: 'spinRight', speed: 60, duration: spinSecondsForDegrees(90, 60) },
      ]).flat(),
    },
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
