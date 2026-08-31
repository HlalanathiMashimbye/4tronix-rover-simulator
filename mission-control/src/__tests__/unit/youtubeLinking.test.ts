/**
 * Matching uploads back to missions, from Mission Control rather than a yard.
 */

import {
  claimedMissions,
  missionIdFromDescription,
  runToLink,
  watchUrl,
} from '@/core/domain/services/youtubeLinking';
import type { MissionRun } from '@/core/domain/entities/MissionRun';

function run(over: Partial<MissionRun> = {}): MissionRun {
  return { yardId: 'curiosity', status: 'completed', ...over } as MissionRun;
}

describe('reading the mission id out of a description', () => {
  it('finds the line the run station generates', () => {
    expect(
      missionIdFromDescription('Lunar Mapper, driven by a real rover.\n\nMissionID: m-7f3a91'),
    ).toBe('m-7f3a91');
  });

  it('tolerates the spacing a person might retype', () => {
    expect(missionIdFromDescription('MissionID:m1')).toBe('m1');
    expect(missionIdFromDescription('MissionID:   m1')).toBe('m1');
  });

  it('is null when the description says nothing about a mission', () => {
    expect(missionIdFromDescription('Our rover doing a square!')).toBeNull();
    expect(missionIdFromDescription('')).toBeNull();
  });

  it('needs the marker, not a mention of it', () => {
    // Prose about the field must not link a mission called "is".
    expect(missionIdFromDescription('the MissionID is below')).toBeNull();
  });
});

describe('what the recent uploads claim', () => {
  it('ignores videos with no marker, so a poll of ordinary uploads is free', () => {
    const claims = claimedMissions([
      { videoId: 'v1', description: 'holiday video' },
      { videoId: 'v2', description: 'MissionID: m1' },
    ]);

    expect(claims).toEqual([{ missionId: 'm1', videoId: 'v2' }]);
  });

  it('lets a re-upload win, because that is why people re-upload', () => {
    // Newest first, as the API returns them.
    const claims = claimedMissions([
      { videoId: 'new', description: 'MissionID: m1' },
      { videoId: 'old', description: 'MissionID: m1' },
    ]);

    expect(claims).toEqual([{ missionId: 'm1', videoId: 'new' }]);
  });

  it('builds a watchable url', () => {
    expect(watchUrl('abc123')).toBe('https://www.youtube.com/watch?v=abc123');
  });
});

describe('choosing which run the video belongs to', () => {
  it('takes the most recently completed run without a video', () => {
    const chosen = runToLink([
      run({ yardId: 'a', completedAt: '2026-08-01T10:00:00Z' }),
      run({ yardId: 'b', completedAt: '2026-08-30T10:00:00Z' }),
    ]);

    expect(chosen?.yardId).toBe('b');
  });

  it('never steals a run that already has its video', () => {
    const chosen = runToLink([
      run({ yardId: 'a', completedAt: '2026-08-30T10:00:00Z', youtubeUrl: 'https://y/1' }),
      run({ yardId: 'b', completedAt: '2026-08-01T10:00:00Z' }),
    ]);

    expect(chosen?.yardId).toBe('b');
  });

  it('is null once every completed run has a video', () => {
    /**
     * The ordinary case on every poll after the one that first saw the
     * upload. Attaching again is a write that changes nothing and an email
     * that repeats itself.
     */
    expect(runToLink([run({ youtubeUrl: 'https://y/1' })])).toBeNull();
  });

  it('will not attach to a run that has not finished', () => {
    expect(runToLink([run({ status: 'processing' })])).toBeNull();
  });

  it('is null for a mission nothing has run', () => {
    expect(runToLink([])).toBeNull();
  });
});
