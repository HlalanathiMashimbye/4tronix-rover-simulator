/**
 * YouTubeVideoId: reading a video out of a pasted link, and the addresses
 * built back from it.
 */

import { YouTubeVideoId } from '@/core/domain/entities/YouTubeVideoId';

it.each([
  'https://youtu.be/dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ?si=share',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
  'https://www.youtube.com/embed/dQw4w9WgXcQ',
])('reads the video out of %s', (url) => {
  expect(YouTubeVideoId.fromUrl(url)?.value).toBe('dQw4w9WgXcQ');
});

it.each([
  ['an id that is too short', 'https://youtu.be/tooshort'],
  ['an id that is too long', 'https://www.youtube.com/watch?v=dQw4w9WgXcQextra'],
  ['a link to something else', 'https://example.com/watch'],
  ['nothing', ''],
])('finds no video in %s', (_case, url) => {
  expect(YouTubeVideoId.fromUrl(url)).toBeNull();
});

it('builds the watch link and both poster frames from the id', () => {
  const video = YouTubeVideoId.of('dQw4w9WgXcQ');

  expect(video.watchUrl()).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(video.thumbnailUrl('mq')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  expect(video.thumbnailUrl('hq')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

it('treats a share link and a watch link to one video as the same video', () => {
  const shared = YouTubeVideoId.fromUrl('https://youtu.be/dQw4w9WgXcQ?si=x');
  const watched = YouTubeVideoId.fromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  expect(shared?.equals(watched)).toBe(true);
  expect(shared?.equals(YouTubeVideoId.of('aaaaaaaaaaa'))).toBe(false);
  expect(shared?.equals(null)).toBe(false);
});
