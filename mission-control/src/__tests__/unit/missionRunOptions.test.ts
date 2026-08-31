/**
 * Which run a learner lands on, and in what order.
 *
 * David's point at the 2026-08-27 standup: a child could not tell that a real
 * rover had driven their code, because the selector was a closed dropdown with
 * the simulation first. The ordering here is the fix, so it is pinned.
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


describe('what a learner sees first', () => {
  it('puts the real rover run before the simulation', () => {
    // A child opening their mission lands on the rover, not on a simulation
    // they already watched while writing the code.
    const runs = buildRunOptions({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', yardId: 'curiosity' }, [], YARDS);

    expect(runs[0].kind).toBe('real');
    expect(runs[1].kind).toBe('sim');
  });

  it('names the city on the real run, so it means something to a nine-year-old', () => {
    const runs = buildRunOptions({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', yardId: 'curiosity' }, [], YARDS);

    expect(runs[0].label).toBe('Cape Town');
    expect(runs[0].sublabel).toBe('Real rover');
  });

  it('still labels a real run from a yard it does not recognise', () => {
    // No place name, but the run is real and must not be hidden for it.
    const runs = buildRunOptions({ youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', yardId: 'durban-9' }, [], YARDS);

    expect(runs[0].kind).toBe('real');
    expect(runs[0].label).toBe('Real rover');
  });

  it('falls back to the simulation when no rover has run it yet', () => {
    const runs = buildRunOptions({ yardId: 'curiosity' }, [], YARDS);

    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe('sim');
  });

  it('treats a legacy videoUrl the same as youtubeUrl', () => {
    // Older missions carry videoUrl. A child with one should still land on it.
    const runs = buildRunOptions({ videoUrl: 'https://youtube.com/watch?v=dQw4w9WgXcQ' }, [], YARDS);

    expect(runs[0].kind).toBe('real');
  });

  it('offers no real run for an unparseable video url', () => {
    // Better to show only the simulation than a player with nothing in it.
    const runs = buildRunOptions({ youtubeUrl: 'not-a-youtube-link' }, [], YARDS);

    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe('sim');
  });

  it('survives a mission that has not loaded yet', () => {
    expect(buildRunOptions(null)[0].kind).toBe('sim');
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
