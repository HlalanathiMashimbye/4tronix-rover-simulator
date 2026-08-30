/**
 * What a learner can put on a world-readable document (AB#402).
 *
 * Mission documents are public by design - the feed is meant to be shared and
 * learners are never signed in - so anything a child controls that lands on one
 * is a potential channel to strangers. The marker raised this specifically
 * because of how young the users are.
 *
 * The mission NAME is the sharp end: it is shown on every card, in the feed and
 * in the operator queue. The input has been read-only for a while, but the API
 * accepted any string up to 100 characters, so the control lived only in the
 * browser. 47 of the first 400 missions carry names the generator could never
 * have produced, including one deliberately inappropriate entry that reached an
 * operator's queue.
 */

import {
  allGeneratedMissionNames,
  generateRandomMissionName,
  isGeneratedMissionName,
} from '@/core/domain/services/missionNameGenerator';
import { validateMission } from '@/infrastructure/validation/schemas';

const valid = {
  yardId: 'curiosity',
  learnerId: 'learner-123',
  sessionId: 'V1StGXR8Z5jdHi6BmyT8r',
  name: 'Red Explorer',
  code: 'rover.forward(60)',
};

describe('the mission name is a closed vocabulary', () => {
  it('accepts every name the generator can produce', () => {
    const all = allGeneratedMissionNames();

    expect(all.length).toBeGreaterThan(100);
    expect(all.every(isGeneratedMissionName)).toBe(true);
  });

  it('accepts what the generator actually generates', () => {
    for (let i = 0; i < 50; i++) {
      expect(isGeneratedMissionName(generateRandomMissionName())).toBe(true);
    }
  });

  it('rejects the free text that reached production', () => {
    // Real names read back off live mission documents.
    const actual = [
      'MARK ROBER',
      'misson imposible',
      "Werner is Square'ish",
      'Desert Collector (test)',
      'Final check 1785626567920',
      'Ace',
    ];

    for (const name of actual) {
      expect(isGeneratedMissionName(name)).toBe(false);
    }
  });

  it('rejects a message dressed up as two words', () => {
    // The point of a closed vocabulary: it does not matter what the text says,
    // only that it is not a pairing from the list. A blocklist would be an
    // endless argument with whoever is trying to get past it.
    for (const name of ['Call Me', 'Red hello', 'Explorer Red', 'Red  Explorer', 'Red']) {
      expect(isGeneratedMissionName(name)).toBe(false);
    }
  });
});

describe('the API is the boundary, not the input control', () => {
  it('accepts a generated name', () => {
    expect(validateMission(valid).success).toBe(true);
  });

  it('refuses free text posted straight at the API', () => {
    // A read-only field in the browser stops nobody with curl.
    const result = validateMission({ ...valid, name: 'meet me at the gate' });

    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('generated, not typed');
  });

  it('refuses a name that is nearly right', () => {
    expect(validateMission({ ...valid, name: 'Red Explorer!' }).success).toBe(false);
    expect(validateMission({ ...valid, name: 'red explorer' }).success).toBe(false);
  });

  it('refuses a sessionId carrying anything but an id', () => {
    // Never displayed, so not a channel anyone would read, but it does land on
    // a public document and a free-form string there is a loose end.
    expect(validateMission({ ...valid, sessionId: 'hello there friend' }).success).toBe(false);
    expect(validateMission({ ...valid, sessionId: 'V1StGXR8Z5jdHi6BmyT8r' }).success).toBe(true);
  });
});
