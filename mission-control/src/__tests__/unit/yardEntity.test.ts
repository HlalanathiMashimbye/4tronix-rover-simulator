/**
 * Yards as data: what may be selected, what must still resolve.
 */

import {
  findYardIn,
  isSelectableYard,
  selectableYards,
  yardLabelOf,
  type Yard,
} from '@/core/domain/entities/Yard';

function yard(over: Partial<Yard> = {}): Yard {
  return {
    id: 'curiosity',
    name: 'Cape Town Science Centre',
    area: 'Observatory',
    city: 'Cape Town',
    active: true,
    ...over,
  };
}

describe('resolving a yard for the read path', () => {
  it('finds it by id', () => {
    expect(findYardIn([yard()], 'curiosity')?.city).toBe('Cape Town');
  });

  it('still resolves an id the yard used to have', () => {
    /**
     * Missions keep the id they were submitted with. Cape Town has been
     * uct-rover-1 and cape-town, and a child opening an old mission must
     * still see where it ran.
     */
    const yards = [yard({ formerIds: ['uct-rover-1', 'cape-town'] })];

    expect(findYardIn(yards, 'uct-rover-1')?.city).toBe('Cape Town');
  });

  it('STILL RESOLVES A RETIRED YARD', () => {
    /**
     * The reason retiring exists rather than deleting. Every mission ever run
     * here references this id; if it stopped resolving, those pages would
     * silently lose their location.
     */
    const yards = [yard({ active: false })];

    expect(findYardIn(yards, 'curiosity')?.city).toBe('Cape Town');
  });

  it('is undefined for an id nobody knows', () => {
    expect(findYardIn([yard()], 'atlantis')).toBeUndefined();
  });
});

describe('choosing a yard to work at', () => {
  it('accepts an active yard', () => {
    expect(isSelectableYard([yard()], 'curiosity')).toBe(true);
  });

  it('refuses a retired one, which is what retiring is for', () => {
    expect(isSelectableYard([yard({ active: false })], 'curiosity')).toBe(false);
  });

  it('refuses a former id, so a write cannot name a yard by its old name', () => {
    // Lenient in what is read, strict in what is written.
    const yards = [yard({ formerIds: ['uct-rover-1'] })];

    expect(isSelectableYard(yards, 'uct-rover-1')).toBe(false);
  });

  it('offers only active yards, ordered by city then venue', () => {
    const list = selectableYards([
      yard({ id: 'c', city: 'Durban', name: 'Bravo' }),
      yard({ id: 'd', city: 'Cape Town', name: 'Zulu' }),
      yard({ id: 'e', city: 'Cape Town', name: 'Alpha' }),
      yard({ id: 'f', city: 'Limpopo', active: false }),
    ]);

    expect(list.map((y) => y.name)).toEqual(['Alpha', 'Zulu', 'Bravo']);
  });
});

describe('how a yard reads', () => {
  it('names the venue and the suburb', () => {
    expect(yardLabelOf(yard())).toBe('Cape Town Science Centre, Observatory');
  });
});
