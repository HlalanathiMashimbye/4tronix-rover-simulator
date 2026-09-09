/**
 * Generates pseudonymous nicknames for leaderboard display
 *
 * Ensures learners are never identified by real information.
 * Random, memorable, and completely disconnected from learner identity.
 */

const ADJECTIVES = [
  'Clever',
  'Brave',
  'Curious',
  'Swift',
  'Steady',
  'Bold',
  'Quick',
  'Wise',
  'Smart',
  'Sharp',
  'Keen',
  'Nimble',
  'Alert',
  'Bright',
  'Eager',
];

const NOUNS = [
  'Comet',
  'Rover',
  'Astronaut',
  'Pilot',
  'Explorer',
  'Navigator',
  'Discoverer',
  'Engineer',
  'Scientist',
  'Satellite',
  'Orbiter',
  'Probe',
  'Voyager',
  'Stargazer',
  'Wanderer',
];

/**
 * Generate a random two-word nickname
 * Uses the same random pattern as existing code (Learner.ts)
 */
export function generateNickname(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adjective} ${noun}`;
}
