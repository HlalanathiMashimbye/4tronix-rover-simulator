/**
 * How a list of missions is ordered.
 *
 * Four faults are pinned here, all reported together from one session at a
 * yard: there was no way to order a list at all; the operator's Done list was
 * ordered by when a mission was SUBMITTED, so the run that had just finished
 * sat below one from hours earlier; searching only ever looked at the
 * currently selected filter; and cancelled missions were in no list at all.
 */

import type { Mission } from '@/core/domain/entities/Mission';
import {
  MISSION_SORTS,
  DEFAULT_MISSION_SORT,
  isMissionSort,
  sortMissions,
  type SortableMission,
} from '@/core/domain/services/missionSort';

const at = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

const mission = (over: Partial<SortableMission> & { id: string }): SortableMission => ({
  submittedAt: at(1),
  ...over,
});

describe('ordering by date', () => {
  it('puts the most recent first, and least recent reverses it', () => {
    const list = [
      mission({ id: 'b', submittedAt: at(2) }),
      mission({ id: 'a', submittedAt: at(5) }),
      mission({ id: 'c', submittedAt: at(1) }),
    ];

    expect(sortMissions(list, 'newest').map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(sortMissions(list, 'oldest').map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });

  it('treats a finished mission by when it FINISHED, not when it was sent', () => {
    // The operator's complaint. The mission submitted first but completed last
    // is the one they just watched finish, and it belongs at the top.
    const early = mission({ id: 'early', submittedAt: at(1), completedAt: at(9) });
    const late = mission({ id: 'late', submittedAt: at(5) });

    expect(sortMissions([late, early], 'newest').map((m) => m.id)).toEqual(['early', 'late']);
  });

  it('falls back to submission for a mission that never completed', () => {
    // A cancelled mission has no completedAt at all, and must still sort.
    const cancelled = mission({ id: 'cancelled', submittedAt: at(7) });
    const done = mission({ id: 'done', submittedAt: at(1), completedAt: at(3) });

    expect(sortMissions([done, cancelled], 'newest').map((m) => m.id)).toEqual([
      'cancelled',
      'done',
    ]);
  });

  it('does not fall over on a missing or unparseable date', () => {
    const broken = mission({ id: 'broken', submittedAt: 'not a date' });
    const absent = { id: 'absent' } as SortableMission;
    const good = mission({ id: 'good', submittedAt: at(4) });

    const ordered = sortMissions([broken, good, absent], 'newest');

    expect(ordered[0].id).toBe('good');
    expect(ordered).toHaveLength(3);
  });
});

describe('ordering by name', () => {
  it('sorts A to Z and Z to A', () => {
    const list = [
      mission({ id: '1', name: 'Rocky Square' }),
      mission({ id: '2', name: 'Apollo Run' }),
      mission({ id: '3', name: 'Zebra Crossing' }),
    ];

    expect(sortMissions(list, 'name-az').map((m) => m.name)).toEqual([
      'Apollo Run', 'Rocky Square', 'Zebra Crossing',
    ]);
    expect(sortMissions(list, 'name-za').map((m) => m.name)).toEqual([
      'Zebra Crossing', 'Rocky Square', 'Apollo Run',
    ]);
  });

  it('ignores case, so a lowercase name is not exiled to one end', () => {
    const list = [
      mission({ id: '1', name: 'banana' }),
      mission({ id: '2', name: 'Apple' }),
      mission({ id: '3', name: 'cherry' }),
    ];

    expect(sortMissions(list, 'name-az').map((m) => m.name)).toEqual([
      'Apple', 'banana', 'cherry',
    ]);
  });

  it('reads numbers in a name the way a person does', () => {
    // Plain string ordering puts "Attempt 10" before "Attempt 2".
    const list = [
      mission({ id: '1', name: 'Attempt 10' }),
      mission({ id: '2', name: 'Attempt 2' }),
    ];

    expect(sortMissions(list, 'name-az').map((m) => m.name)).toEqual([
      'Attempt 2', 'Attempt 10',
    ]);
  });

  it('keeps unnamed missions at the bottom in BOTH directions', () => {
    // "No name" is not a name at either end of the alphabet, so reversing the
    // order must not promote them to the top.
    const list = [
      mission({ id: '1' }),
      mission({ id: '2', name: 'Named' }),
      mission({ id: '3', name: '   ' }),
    ];

    expect(sortMissions(list, 'name-az')[0].name).toBe('Named');
    expect(sortMissions(list, 'name-za')[0].name).toBe('Named');
  });
});

describe('the ordering is safe to use', () => {
  it('does not disturb the caller\'s array', () => {
    const list = [mission({ id: 'b', submittedAt: at(1) }), mission({ id: 'a', submittedAt: at(9) })];
    const before = list.map((m) => m.id);

    sortMissions(list, 'newest');

    expect(list.map((m) => m.id)).toEqual(before);
  });

  it('is total, so equal missions never swap between renders', () => {
    // Same instant and same name: without a tiebreak the order is whatever
    // the sort implementation happens to do, and can differ between calls.
    const list = [
      mission({ id: 'zzz', name: 'Same', submittedAt: at(3) }),
      mission({ id: 'aaa', name: 'Same', submittedAt: at(3) }),
    ];

    for (const sort of MISSION_SORTS) {
      const once = sortMissions(list, sort.key).map((m) => m.id);
      const twice = sortMissions([...list].reverse(), sort.key).map((m) => m.id);
      expect(once).toEqual(twice);
    }
  });

  it('recognises only the orderings it offers', () => {
    for (const s of MISSION_SORTS) expect(isMissionSort(s.key)).toBe(true);
    expect(isMissionSort('done')).toBe(false);
    expect(isMissionSort('review')).toBe(false);
    expect(isMissionSort(undefined)).toBe(false);
  });

  it('offers both directions of both orderings, which is what was asked for', () => {
    expect(MISSION_SORTS.map((s) => s.key).sort()).toEqual(
      ['name-az', 'name-za', 'newest', 'oldest'],
    );
    expect(isMissionSort(DEFAULT_MISSION_SORT)).toBe(true);
  });

  it('accepts an operator queue record, which is not a full Mission', () => {
    // The console's QueueMission carries no learner or yard. If the comparator
    // demanded a whole Mission the console would need its own copy, which is
    // how the two ends up disagreeing about what "most recent" means.
    const queueShaped = { id: 'q1', name: 'Queue', submittedAt: at(2) };
    const full = { id: 'm1', name: 'Full', submittedAt: at(1) } as Mission;

    expect(sortMissions([queueShaped, full], 'newest').map((m) => m.id)).toEqual(['q1', 'm1']);
  });
});
