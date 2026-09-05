/**
 * How a list of missions is ordered, in one place.
 *
 * The operator console and the learner feed both show lists of missions and
 * both offer the same four orderings, so the comparator lives here rather than
 * once in each. A second copy is how the two ends up disagreeing about what
 * "most recent" means, which is exactly the fault this file was written after.
 *
 * Ordering is a rule about missions, so it belongs to the domain. It reads
 * nothing but the entity.
 */

/**
 * The only fields an ordering reads.
 *
 * Deliberately not `Mission`. The operator console's QueueMission is a
 * narrower record with no learner or yard on it, and it sorts by exactly the
 * same rules - depending on the whole entity here would have forced the
 * console to invent its own comparator, which is the duplication this file
 * exists to prevent.
 */
export interface SortableMission {
  id: string;
  name?: string;
  submittedAt?: string;
  completedAt?: string;
}

export type MissionSort = 'newest' | 'oldest' | 'name-az' | 'name-za';

export const DEFAULT_MISSION_SORT: MissionSort = 'newest';

/** The orderings offered, in the order they are offered. */
export const MISSION_SORTS: { key: MissionSort; label: string }[] = [
  { key: 'newest', label: 'Most recent' },
  { key: 'oldest', label: 'Least recent' },
  { key: 'name-az', label: 'Name A to Z' },
  { key: 'name-za', label: 'Name Z to A' },
];

export function isMissionSort(value: unknown): value is MissionSort {
  return MISSION_SORTS.some((s) => s.key === value);
}

/**
 * When a mission last mattered.
 *
 * completedAt when there is one, submittedAt otherwise. A mission submitted
 * this morning and finished a minute ago is more recent than one submitted at
 * lunchtime and still waiting, and sorting the Done list by submission put the
 * run that had just finished below one from hours earlier - which is the
 * opposite of where an operator looks for it.
 *
 * Missions that never completed have no completedAt and fall back to when they
 * were submitted, which is the only date they have.
 */
function recencyOf(mission: SortableMission): number {
  // Both are ISO strings on the entity. An unparseable or absent date sorts as
  // the epoch rather than as NaN, which would make the comparator
  // inconsistent and let Array.sort produce a different order each call.
  const time = Date.parse(mission.completedAt ?? mission.submittedAt ?? '');
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Case-insensitive, and numbers inside names sort the way a person reads them,
 * so "Attempt 2" comes before "Attempt 10". An unnamed mission sorts last in
 * both directions rather than jumping to the top of Z to A, because "no name"
 * is not a name at either end of the alphabet.
 */
function compareNames(a: SortableMission, b: SortableMission, direction: 1 | -1): number {
  const an = (a.name ?? '').trim();
  const bn = (b.name ?? '').trim();
  if (!an && !bn) return 0;
  if (!an) return 1;
  if (!bn) return -1;
  return direction * an.localeCompare(bn, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * A comparator for the given ordering.
 *
 * Ties break on id so the order is total: two missions submitted in the same
 * second, or sharing a name, must not swap places between renders.
 */
export function compareMissionsBy(sort: MissionSort): (a: SortableMission, b: SortableMission) => number {
  return (a, b) => {
    let result: number;
    switch (sort) {
      case 'oldest':
        result = recencyOf(a) - recencyOf(b);
        break;
      case 'name-az':
        result = compareNames(a, b, 1);
        break;
      case 'name-za':
        result = compareNames(a, b, -1);
        break;
      case 'newest':
      default:
        result = recencyOf(b) - recencyOf(a);
        break;
    }
    return result !== 0 ? result : a.id.localeCompare(b.id);
  };
}

/** A new array in the given order. Never sorts the caller's array in place. */
export function sortMissions<T extends SortableMission>(missions: T[], sort: MissionSort): T[] {
  return [...missions].sort(compareMissionsBy(sort));
}
