/**
 * Mission links built from the name: /missions/<name-words>-<id prefix>.
 */

import {
  MISSION_SLUG_ID_LENGTH,
  missionSlug,
  parseMissionSlug,
  pickLinkedMission,
} from '@/core/domain/services/missionSlug';
import { allGeneratedMissionNames } from '@/core/domain/services/missionNameGenerator';

const NAMES = allGeneratedMissionNames();
const NAME = NAMES[0];
const ID = 'jLSLqPhCp1RuUo2CpfQUA';
const words = (name: string) => name.toLowerCase().split(' ').join('-');

describe('building a link', () => {
  it('is the name in words and the start of the ID', () => {
    expect(missionSlug({ id: ID, name: NAME })).toBe(`${words(NAME)}-jLSLqP`);
  });

  it('never puts a typed name in a URL', () => {
    // Early missions carry names a child typed (AB#402); those keep the ID.
    for (const name of ['MARK ROBER', 'misson imposible', '', 'Sunny <b>x</b> Rover']) {
      expect(missionSlug({ id: ID, name })).toBe(ID);
    }
    expect(missionSlug({ id: ID })).toBe(ID);
  });

  it('gives an old two-word name a link too', () => {
    const [, b, c] = NAME.split(' ');
    expect(missionSlug({ id: ID, name: `${b} ${c}` })).toBe(`${words(`${b} ${c}`)}-jLSLqP`);
  });
});

describe('reading a link', () => {
  it('round-trips every name the vocabulary allows', () => {
    for (const name of NAMES) {
      const link = parseMissionSlug(missionSlug({ id: ID, name }));
      expect(link).toEqual({ kind: 'prefix', prefix: 'jLSLqP', name });
    }
  });

  it('takes the ID part from the end, because nanoid IDs can contain hyphens', () => {
    const id = 'ab-c_eXYZ1234567890abc';
    const link = parseMissionSlug(missionSlug({ id, name: NAME }));
    expect(link).toEqual({ kind: 'prefix', prefix: 'ab-c_e', name: NAME });
    expect(link.kind === 'prefix' && link.prefix).toHaveLength(MISSION_SLUG_ID_LENGTH);
  });

  it('reads every link shared before this as a full ID', () => {
    expect(parseMissionSlug(ID)).toEqual({ kind: 'id', id: ID });
    expect(parseMissionSlug('a-b-c-d-e-f-ghijklmno')).toEqual({ kind: 'id', id: 'a-b-c-d-e-f-ghijklmno' });
  });

  it('does not treat words outside the generator as a name', () => {
    expect(parseMissionSlug('mark-rober-jLSLqP')).toEqual({ kind: 'id', id: 'mark-rober-jLSLqP' });
  });
});

describe('choosing the mission a link means', () => {
  const link = { prefix: 'jLSLqP', name: NAME };
  const other = NAMES[1];

  it('takes the only mission with that prefix, even if the words were mistyped', () => {
    const only = { id: ID, name: other };
    expect(pickLinkedMission(link, [only])).toBe(only);
  });

  it('tells two missions sharing a prefix apart by name', () => {
    const a = { id: 'jLSLqPaaaaaaaaaaaaaaa', name: other };
    const b = { id: 'jLSLqPbbbbbbbbbbbbbbb', name: NAME };
    expect(pickLinkedMission(link, [a, b])).toBe(b);
  });

  it('does not guess between two it cannot tell apart', () => {
    const a = { id: 'jLSLqPaaaaaaaaaaaaaaa', name: other };
    const b = { id: 'jLSLqPbbbbbbbbbbbbbbb', name: other };
    expect(pickLinkedMission(link, [a, b])).toBeNull();
  });

  it('finds nothing when no mission has the prefix', () => {
    expect(pickLinkedMission(link, [])).toBeNull();
    expect(pickLinkedMission(link, [{ id: 'zzzzzzzz', name: NAME }])).toBeNull();
  });
});
