/**
 * The words in a mission's link: /missions/sunny-crater-climber-jLSLqP.
 *
 * David asked for the three-word name instead of the random ID. The name
 * alone cannot be the link yet: missions named before 8 October 2026 got
 * random names from 8,000, and many of them share one, and a link that opens
 * another child's mission is worse than an ugly one. So the name is followed
 * by the start of the mission ID, and only that part finds the mission; the
 * words are there for people. Missions named since are unique
 * (IMissionNameRegistry), so their words alone could find them.
 *
 * Only generated names go into a link. Early missions carry names a child
 * typed (missionNameGenerator.ts, AB#402), one of them inappropriate, and a
 * URL is copied and shared further than a card is ever seen. Those keep the
 * plain ID.
 *
 * Mission IDs come from nanoid, whose alphabet includes '-' and '_', so a link
 * is never split on hyphens to find the ID: the ID part is always the last
 * MISSION_SLUG_ID_LENGTH characters.
 */

import { isGeneratedMissionName } from './missionNameGenerator';

/**
 * 64^6 is about 69 billion prefixes, so two missions sharing one is not a
 * practical concern; the mission page still copes if it happens.
 */
export const MISSION_SLUG_ID_LENGTH = 6;

/** "Sunny Crater Climber" -> "sunny-crater-climber". */
function nameToWords(name: string): string {
  return name.toLowerCase().split(' ').join('-');
}

/**
 * "sunny-crater-climber" -> "Sunny Crater Climber", or null when the words are
 * not a name the generator makes. Every word in the lists is one capitalised
 * word, which is what makes this the exact inverse of nameToWords (the tests
 * check it against all 8,000 names).
 */
function wordsToName(words: string): string | null {
  const name = words
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return isGeneratedMissionName(name) ? name : null;
}

/** The path segment for a mission's page. */
export function missionSlug(mission: { id: string; name?: string }): string {
  if (!mission.name || !isGeneratedMissionName(mission.name)) return mission.id;
  if (mission.id.length <= MISSION_SLUG_ID_LENGTH) return mission.id;
  return `${nameToWords(mission.name)}-${mission.id.slice(0, MISSION_SLUG_ID_LENGTH)}`;
}

export type MissionLink =
  | { kind: 'id'; id: string }
  | { kind: 'prefix'; prefix: string; name: string };

/**
 * What a /missions/<segment> link points at. A segment that is not a name
 * followed by an ID prefix is taken as a full ID, which is what every link
 * shared before this existed is.
 */
export function parseMissionSlug(segment: string): MissionLink {
  const cut = segment.length - MISSION_SLUG_ID_LENGTH - 1;
  if (cut > 0 && segment[cut] === '-') {
    const name = wordsToName(segment.slice(0, cut));
    if (name) {
      return { kind: 'prefix', prefix: segment.slice(cut + 1), name };
    }
  }
  return { kind: 'id', id: segment };
}

/**
 * Which of the missions sharing an ID prefix a link means. The one whose name
 * matches too; failing that, the only one there is, so a link with a mistyped
 * name still opens. Two with neither is not guessed at.
 */
export function pickLinkedMission<T extends { id: string; name?: string }>(
  link: { prefix: string; name: string },
  candidates: T[],
): T | null {
  const matching = candidates.filter((m) => m.id.startsWith(link.prefix));
  const named = matching.filter((m) => m.name === link.name);
  if (named.length === 1) return named[0];
  if (matching.length === 1) return matching[0];
  return null;
}
