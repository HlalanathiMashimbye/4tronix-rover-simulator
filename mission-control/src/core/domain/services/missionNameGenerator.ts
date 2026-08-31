/**
 * Mission Name Generator
 *
 * Generates friendly mission names from three words, e.g. "Swift Helios
 * Explorer", "Brave Red Pathfinder". No numeric suffix and no dashes (per
 * David's feedback): names are for humans to recognise and re-roll.
 *
 * ON "UNIQUE" (Story AB#330). The story asks for a unique name. These are not
 * unique and cannot be: a closed vocabulary has a fixed size, and the only
 * ways to guarantee uniqueness are a numeric suffix, which David rejected, or
 * a round-trip collision check against Firestore on every page load, which
 * costs a read per learner to solve a problem nobody has reported.
 *
 * What the widening from two words to three does buy is scarcity. 20x20 = 400
 * names across 121 missions made repeats a mathematical certainty; three lists
 * give 8,000, so a learner is unlikely to meet their own name twice and the
 * re-roll button handles the rest. If true uniqueness is ever actually needed,
 * that is a different story and it has to reopen David's decision first.
 *
 * THE WORD LISTS ARE A SAFETY CONTROL, NOT DECORATION (AB#402).
 *
 * A mission name is the one learner-controlled string shown prominently on a
 * world-readable document: the feed, every card, the operator queue. If a child
 * can type into it, the platform has a public message board with children on
 * both ends of it.
 *
 * The name input has been read-only for a while, but the API took any string up
 * to 100 characters, so the control existed only in the browser. 47 of the
 * first 400 missions carry names the generator could never have produced -
 * "MARK ROBER", "misson imposible", and one deliberately inappropriate entry
 * that reached the operator's queue.
 *
 * isGeneratedMissionName is what makes the vocabulary the actual boundary, and
 * it is enforced server-side in validation/schemas.ts. Adding a word here adds
 * it to what a learner may publish, so treat this list as reviewed content.
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
];

/**
 * Generate a random mission name
 *
 * @returns A three-word name like "Swift Helios Explorer" (no number, no dashes)
 */
export function generateRandomMissionName(): string {
  const pick = (words: readonly string[]) =>
    words[Math.floor(Math.random() * words.length)];

  return `${pick(PART0_WORDS)} ${pick(PART1_WORDS)} ${pick(PART2_WORDS)}`;
}

/**
 * Generate multiple random mission names (for display options)
 *
 * @param count - Number of names to generate
 * @returns Array of random mission names
 */
export function generateMissionNameSuggestions(count: number = 3): string[] {
  const names: Set<string> = new Set();

  while (names.size < count) {
    names.add(generateRandomMissionName());
  }

  return Array.from(names);
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
 * the adjective was added, and a learner re-opening an old mission or a stale
 * browser tab submitting one must not be told their name is invalid. Both
 * shapes are closed vocabularies, so accepting the older one costs no safety.
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
 * Every name this generator can produce: 20 x 20 x 20 = 8,000. Exported for
 * tests and for review - adding a word here adds it to what a learner may
 * publish on a world-readable document.
 */
export function allGeneratedMissionNames(): string[] {
  return PART0_WORDS.flatMap((a) =>
    PART1_WORDS.flatMap((b) => PART2_WORDS.map((c) => `${a} ${b} ${c}`)),
  );
}
