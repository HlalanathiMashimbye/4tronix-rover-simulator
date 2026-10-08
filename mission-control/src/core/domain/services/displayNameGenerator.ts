/**
 * Display Name Generator
 *
 * Generates pseudonymous two-word names for learner profiles and the
 * leaderboard. Same closed-vocabulary pattern as mission names: the lists are
 * the safety boundary, enforced server-side by isGeneratedDisplayName.
 *
 * Two words rather than three keeps names compact in the navbar and on
 * leaderboard rows. 20 x 20 = 400 combinations — enough that collisions are
 * rare across the current learner base, and the re-roll button handles the
 * rest.
 *
 * THE WORD LISTS ARE A SAFETY CONTROL.
 *
 * A display name is learner-controlled text shown on the public leaderboard
 * and on mission cards. The same reasoning from missionNameGenerator applies:
 * a closed vocabulary has nothing to argue with, and adding a word here adds
 * it to what a learner may publish. Treat these lists as reviewed content.
 */

const ADJECTIVES = [
  'Astral',
  'Blazing',
  'Cosmic',
  'Daring',
  'Electric',
  'Fearless',
  'Galactic',
  'Heroic',
  'Infinite',
  'Jolly',
  'Kinetic',
  'Lunar',
  'Mystic',
  'Noble',
  'Orbital',
  'Polar',
  'Quantum',
  'Radiant',
  'Stellar',
  'Turbo',
];

const NOUNS = [
  'Ace',
  'Captain',
  'Cadet',
  'Comet',
  'Cosmonaut',
  'Falcon',
  'Griffin',
  'Hawk',
  'Jetpack',
  'Knight',
  'Lynx',
  'Martian',
  'Nebula',
  'Orbiter',
  'Phoenix',
  'Ranger',
  'Sparrow',
  'Titan',
  'Viper',
  'Wolf',
];

export function generateDisplayName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

/**
 * Whether a name is one this generator could have produced.
 *
 * Exactly two known words separated by a single space. Anything else is free
 * text and is rejected.
 */
export function isGeneratedDisplayName(name: string): boolean {
  const parts = name.split(' ');
  if (parts.length !== 2) return false;
  return ADJECTIVES.includes(parts[0]) && NOUNS.includes(parts[1]);
}

export function allGeneratedDisplayNames(): string[] {
  return ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a} ${n}`));
}
