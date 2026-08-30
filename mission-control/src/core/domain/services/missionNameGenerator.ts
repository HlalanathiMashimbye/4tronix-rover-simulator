/**
 * Mission Name Generator
 *
 * Generates friendly mission names by pairing two words, e.g. "Helios Explorer",
 * "Red Pathfinder". No numeric suffix and no dashes (per David's feedback):
 * names are for humans to recognise and re-roll, and they need not be unique.
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
 * @returns A two-word name like "Helios Explorer" (no number, no dashes)
 */
export function generateRandomMissionName(): string {
  const part1 = PART1_WORDS[Math.floor(Math.random() * PART1_WORDS.length)];
  const part2 = PART2_WORDS[Math.floor(Math.random() * PART2_WORDS.length)];

  return `${part1} ${part2}`;
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
 * Exactly two known words separated by exactly one space. Deliberately strict:
 * anything that is not a pairing from the lists above is free text, whatever it
 * happens to say, and free text is the thing being prevented.
 */
export function isGeneratedMissionName(name: string): boolean {
  const parts = name.split(' ');
  if (parts.length !== 2) return false;

  return (
    (PART1_WORDS as readonly string[]).includes(parts[0]) &&
    (PART2_WORDS as readonly string[]).includes(parts[1])
  );
}

/** Every name this generator can produce. Exported for tests and for review. */
export function allGeneratedMissionNames(): string[] {
  return PART1_WORDS.flatMap((a) => PART2_WORDS.map((b) => `${a} ${b}`));
}
