/**
 * Mission Name Generator
 *
 * Every mission gets three words, e.g. "Swift Helios Explorer". No numeric
 * suffix and no dashes (per David's feedback): names are for humans.
 *
 * NAMES NEVER REPEAT (David, 8 October 2026). A mission's three words are how
 * a learner finds it again, so two missions sharing them is a bug, and "it's a
 * solved computer science problem". Names used to be picked at random in the
 * browser from 8,000 combinations and kept whatever they were, which made
 * repeats certain once a few hundred missions existed (the birthday problem).
 *
 * What every site with names like these does: suggestions are free, and the
 * name is made unique once, at the moment it is taken. The learner rolls a
 * name in the browser (rollMissionName), as many times as they like, and
 * rolling costs nothing and reserves nothing. When the mission is sent the
 * server claims that name with a single create-if-it-does-not-exist
 * (IMissionNameRegistry.claim), which only one mission can ever win. If
 * someone else got there first, the mission takes the next name from a
 * counter instead: missionNameForNumber turns the counter's number into words
 * one-to-one, stepping through the combinations by a stride so consecutive
 * missions do not share two of their three words.
 *
 * Combinations made only of the first twenty words of each list are skipped:
 * those are the 8,000 the random generator could produce, and missions
 * already carry them. Every name handed out from now on has at least one word
 * added on 8 October, so it cannot be one an older mission has.
 *
 * THE LISTS ONLY GROW AT THE END. A word inserted or removed in the middle
 * would move every later word, and the numbers already handed out would map
 * to different names, some of them taken. The registry refuses a name that is
 * already taken, so that would cost a skipped number rather than a duplicate,
 * but appending is what keeps the mapping meaning the same thing.
 *
 * THE WORD LISTS ARE A SAFETY CONTROL, NOT DECORATION (AB#402).
 *
 * A mission name is shown prominently on a world-readable document: the feed,
 * every card, the operator queue. The name box is read-only, but for a while
 * the API took any string, so the control existed only in the browser: 47 of
 * the first 400 missions carry names the generator could never have produced
 * - "MARK ROBER", "misson imposible", and one deliberately inappropriate entry
 * that reached the operator's queue. isGeneratedMissionName is what makes the
 * vocabulary the actual boundary, enforced server-side in
 * validation/schemas.ts. Adding a word here adds it to what a learner may
 * publish, so treat this list as reviewed content.
 */

const PART0_WORDS = [
  'Swift',
  'Brave',
  'Bright',
  'Bold',
  'Clever',
  'Curious',
  'Daring',
  'Eager',
  'Gentle',
  'Happy',
  'Jolly',
  'Kind',
  'Lucky',
  'Mighty',
  'Nimble',
  'Plucky',
  'Proud',
  'Quiet',
  'Steady',
  'Sunny',
  // Added 8 October 2026, when names became unique. Append only (above).
  'Cheerful',
  'Fearless',
  'Hardy',
  'Keen',
  'Loyal',
  'Patient',
  'Speedy',
  'Spirited',
  'Trusty',
  'Valiant',
  'Wise',
  'Zippy',
];

const PART1_WORDS = [
  'Red',
  'Dust',
  'Solar',
  'Mars',
  'Crater',
  'Rock',
  'Sand',
  'Rover',
  'Terra',
  'Orbital',
  'Lunar',
  'Helios',
  'Aurora',
  'Meteor',
  'Desert',
  'Canyon',
  'Storm',
  'Ridge',
  'Valley',
  'Peak',
  // Added 8 October 2026, when names became unique. Append only (above).
  'Boulder',
  'Comet',
  'Cosmic',
  'Deimos',
  'Galaxy',
  'Gale',
  'Jezero',
  'Nebula',
  'Olympus',
  'Pebble',
  'Phobos',
  'Starlight',
];

const PART2_WORDS = [
  'Pathfinder',
  'Pioneer',
  'Explorer',
  'Nomad',
  'Wanderer',
  'Tracker',
  'Scanner',
  'Probe',
  'Rover',
  'Navigator',
  'Sentinel',
  'Seeker',
  'Mapper',
  'Surveyor',
  'Analyst',
  'Observer',
  'Collector',
  'Prospector',
  'Climber',
  'Traveler',
  // Added 8 October 2026, when names became unique. Append only (above).
  'Builder',
  'Driller',
  'Finder',
  'Guardian',
  'Lander',
  'Orbiter',
  'Ranger',
  'Roamer',
  'Scout',
  'Spotter',
  'Trekker',
  'Voyager',
];

/**
 * How many words of each list the random generator had: every combination of
 * these alone may already be on a mission, so none is handed out again.
 */
const WORDS_BEFORE_UNIQUE_NAMES = 20;

/** How many three-word combinations there are, retired ones included. */
export const MISSION_NAME_COMBINATIONS = PART0_WORDS.length * PART1_WORDS.length * PART2_WORDS.length;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The step between consecutive missions' combinations. Any step sharing no
 * factor with the number of combinations visits every one exactly once before
 * repeating, which is what makes the mapping one-to-one. This one is near the
 * golden ratio of the total, so each step moves all three words.
 */
const STRIDE = (() => {
  let stride = Math.round(MISSION_NAME_COMBINATIONS * 0.618);
  while (gcd(stride, MISSION_NAME_COMBINATIONS) !== 1) stride++;
  return stride;
})();

/**
/** Whether a combination is one of the 8,000 the old random names came from. */
const isRetired = (i0: number, i1: number, i2: number) =>
  i0 < WORDS_BEFORE_UNIQUE_NAMES && i1 < WORDS_BEFORE_UNIQUE_NAMES && i2 < WORDS_BEFORE_UNIQUE_NAMES;

/**
 * The name for the nth mission named from the counter, or null when n is not
 * one to hand out: past the last combination, or a combination of only the
 * original words, which older missions may already carry.
 *
 * Different numbers give different names, always.
 */
export function missionNameForNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n >= MISSION_NAME_COMBINATIONS) return null;
  const combination = (n * STRIDE) % MISSION_NAME_COMBINATIONS;
  const i2 = combination % PART2_WORDS.length;
  const rest = Math.floor(combination / PART2_WORDS.length);
  const i1 = rest % PART1_WORDS.length;
  const i0 = Math.floor(rest / PART1_WORDS.length);
  return isRetired(i0, i1, i2) ? null : `${PART0_WORDS[i0]} ${PART1_WORDS[i1]} ${PART2_WORDS[i2]}`;
}

/**
 * A name for the learner to look at, and roll again if they like.
 *
 * A suggestion, not a reservation: nothing is written anywhere, so rolling is
 * free and a name rolled and never sent is not used up. It may be one another
 * mission takes first, which is settled when this one is sent.
 */
export function rollMissionName(random: () => number = Math.random): string {
  for (;;) {
    const name = missionNameForNumber(Math.floor(random() * MISSION_NAME_COMBINATIONS));
    if (name !== null) return name;
  }
}

/**
 * Whether a name is one a new mission may take: three known words, at least
 * one of them added when names became unique. A name of only the original
 * words is refused here even though a link may carry it, because an older
 * mission may have it and nothing records which ones do.
 */
export function isNewMissionName(name: string): boolean {
  const parts = name.split(' ');
  if (parts.length !== 3) return false;
  const [i0, i1, i2] = [PART0_WORDS.indexOf(parts[0]), PART1_WORDS.indexOf(parts[1]), PART2_WORDS.indexOf(parts[2])];
  return i0 >= 0 && i1 >= 0 && i2 >= 0 && !isRetired(i0, i1, i2);
}

/**
 * Whether a name is one this generator could have produced.
 *
 * Known words separated by single spaces, and nothing else. Deliberately
 * strict: anything that is not a combination from the lists above is free
 * text, whatever it happens to say, and free text is the thing being
 * prevented.
 *
 * Two-word names are still accepted. 121 missions carry them, generated before
 * the adjective was added, and their links (missionSlug) carry those words.
 * Both shapes are closed vocabularies, so accepting the older one costs no
 * safety.
 */
export function isGeneratedMissionName(name: string): boolean {
  const parts = name.split(' ');
  const inList = (list: readonly string[], word: string) => list.includes(word);

  if (parts.length === 3) {
    return (
      inList(PART0_WORDS, parts[0]) &&
      inList(PART1_WORDS, parts[1]) &&
      inList(PART2_WORDS, parts[2])
    );
  }

  // Legacy shape, still present on missions created before AB#330.
  if (parts.length === 2) {
    return inList(PART1_WORDS, parts[0]) && inList(PART2_WORDS, parts[1]);
  }

  return false;
}

/**
 * Every three-word name the vocabulary allows, 32 x 32 x 32 = 32,768: the
 * ones handed out now and the 8,000 older missions may carry. Exported for
 * tests and for review - adding a word here adds it to what is published on a
 * world-readable document.
 */
export function allGeneratedMissionNames(): string[] {
  return PART0_WORDS.flatMap((a) =>
    PART1_WORDS.flatMap((b) => PART2_WORDS.map((c) => `${a} ${b} ${c}`)),
  );
}
