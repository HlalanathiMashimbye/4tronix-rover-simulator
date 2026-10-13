/**
 * Which of the rover's runs a learner can step through.
 *
 * The simulation is not one of them. It was the last card in the same gallery
 * until 10 October 2026, when David opened a mission with a video and could
 * not find its simulation. It is always on the page now (RunFeed.test.tsx),
 * and this list is the rover's runs alone, so that is what is pinned.
 */

import { buildRunOptions, getYouTubeId } from '@/lib/missionRuns';

// The yard list is passed in now rather than imported from a registry, so
// a venue an admin adds today resolves without a deploy.
const YARDS = [
  {
    id: 'curiosity',
    name: 'Cape Town Science Centre',
    area: 'Observatory',
    city: 'Cape Town',
    active: true,
  },
];


describe("the rover's runs", () => {
  it('lists the rover run and nothing else', () => {
    // The simulation used to be appended here, which is what put it behind
    // the arrows of every mission with a video.
    const runs = buildRunOptions({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', yardId: 'curiosity' }, [], YARDS);

    expect(runs).toHaveLength(1);
    expect(runs[0].youtubeId).toBe('dQw4w9WgXcQ');
  });

  it('lists every run that has a video, newest first', () => {
    const run = (id: string, completedAt: string) => ({
      runId: id, yardId: 'curiosity', status: 'completed' as const, youtubeUrl: `https://youtu.be/${id}`, completedAt,
    });
    const runs = buildRunOptions(
      { yardId: 'curiosity' },
      [run('aaaaaaaaaaa', '2026-08-05T10:00:00Z'), run('bbbbbbbbbbb', '2026-08-06T10:00:00Z')],
      YARDS,
    );

    expect(runs.map((r) => r.youtubeId)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  });

  it('names the city on the real run, so it means something to a nine-year-old', () => {
    const runs = buildRunOptions({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', yardId: 'curiosity' }, [], YARDS);

    expect(runs[0].label).toBe('Cape Town');
    expect(runs[0].sublabel).toBe('Real rover');
  });

  it('still labels a real run from a yard it does not recognise', () => {
    // No place name, but the run is real and must not be hidden for it.
    const runs = buildRunOptions({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', yardId: 'durban-9' }, [], YARDS);

    expect(runs).toHaveLength(1);
    expect(runs[0].label).toBe('Real rover');
  });

  it('is empty when no rover has run it yet', () => {
    expect(buildRunOptions({ yardId: 'curiosity' }, [], YARDS)).toEqual([]);
  });

  it('treats a legacy videoUrl the same as youtubeUrl', () => {
    // Older missions carry videoUrl. A child with one should still land on it.
    const runs = buildRunOptions({ videoUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }, [], YARDS);

    expect(runs[0].youtubeId).toBe('dQw4w9WgXcQ');
  });

  it('offers no run for an unparseable video url', () => {
    // Better to show only the simulation than a player with nothing in it.
    expect(buildRunOptions({ youtubeUrl: 'not-a-youtube-link' }, [], YARDS)).toEqual([]);
  });

  it('survives a mission that has not loaded yet', () => {
    expect(buildRunOptions(null)).toEqual([]);
  });
});

describe('getYouTubeId', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('reads the id out of %s', (url, expected) => {
    expect(getYouTubeId(url)).toBe(expected);
  });

  it('rejects an id of the wrong length rather than half-matching', () => {
    expect(getYouTubeId('https://youtu.be/tooshort')).toBeNull();
  });

  it('handles no url at all', () => {
    expect(getYouTubeId(undefined)).toBeNull();
  });
});
