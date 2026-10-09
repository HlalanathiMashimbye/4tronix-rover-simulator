/**
 * What a learner can put on a world-readable document (AB#402).
 *
 * Mission documents are public by design - the feed is meant to be shared and
 * learners are never signed in - so anything a child controls that lands on one
 * is a potential channel to strangers. The marker raised this specifically
 * because of how young the users are.
 *
 * The mission NAME is the sharp end: it is shown on every card, in the feed and
 * in the operator queue. The input was read-only for a while, but the API
 * accepted any string up to 100 characters, so the control lived only in the
 * browser. 47 of the first 400 missions carry names the generator could never
 * have produced, including one deliberately inappropriate entry that reached an
 * operator's queue. Since 8 October 2026 the server names every mission and the
 * browser's say is gone altogether.
 */

import {
  allGeneratedMissionNames,
  isGeneratedMissionName,
  missionNameForNumber,
} from '@/core/domain/services/missionNameGenerator';
import { validateMission } from '@/infrastructure/validation/schemas';

const valid = {
  yardId: 'curiosity',
  learnerId: 'learner-123',
  sessionId: 'V1StGXR8Z5jdHi6BmyT8r',
  code: 'rover.forward(60)',
};

describe('the mission name is a closed vocabulary', () => {
  it('accepts every name the generator can produce', () => {
    const all = allGeneratedMissionNames();

    expect(all.length).toBeGreaterThan(100);
    expect(all.every(isGeneratedMissionName)).toBe(true);
  });

  it('accepts every name the server hands out, all of them three words', () => {
    for (let n = 0; n < 500; n++) {
      const name = missionNameForNumber(n);
      if (name === null) continue;
      expect(isGeneratedMissionName(name)).toBe(true);
      expect(name.split(' ')).toHaveLength(3);
    }
  });

  it('still accepts the two-word names already on live missions', () => {
    /**
     * 121 missions carry names generated before the adjective was added. A
     * learner re-opening an old mission, or a stale browser tab submitting
     * one, must not be told their own name is invalid. Both shapes are closed
     * vocabularies, so accepting the older one costs no safety.
     */
    for (const legacy of ['Red Explorer', 'Terra Mapper', 'Orbital Nomad']) {
      expect(isGeneratedMissionName(legacy)).toBe(true);
    }
  });

  it('rejects an unknown adjective in front of a valid pair', () => {
    // The obvious way to smuggle a word in once names grew a third slot.
    expect(isGeneratedMissionName('Stupid Red Explorer')).toBe(false);
    expect(isGeneratedMissionName('Swift Red Explorer')).toBe(true);
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
  it('drops a name posted straight at the API: the server names missions', () => {
    // Free text from curl, or a stale tab's old name, is not refused, since
    // the stale tab is a learner; it just never reaches the mission
    // (MissionService names it from IMissionNameRegistry).
    for (const name of ['meet me at the gate', 'Red Explorer']) {
      const result = validateMission({ ...valid, name });
      expect(result.success).toBe(true);
      expect(result.data).not.toHaveProperty('name');
    }
  });

  it('refuses a sessionId carrying anything but an id', () => {
    // Never displayed, so not a channel anyone would read, but it does land on
    // a public document and a free-form string there is a loose end.
    expect(validateMission({ ...valid, sessionId: 'hello there friend' }).success).toBe(false);
    expect(validateMission({ ...valid, sessionId: 'V1StGXR8Z5jdHi6BmyT8r' }).success).toBe(true);
  });
});
