import 'server-only';

import type { ChannelVideo } from '@/core/domain/services/youtubeLinking';
import { readSetting } from '@/infrastructure/config/runtimeSettingsStore';

/**
 * The channel's most recent uploads.
 *
 * playlistItems, not search. They answer nearly the same question here, but
 * search.list costs 100 quota units against a 10,000/day allowance while
 * playlistItems costs 1, and the uploads playlist is exactly "this channel's
 * videos, newest first" without the relevance ranking we would then have to
 * ignore.
 */
const UPLOADS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems';

export class YouTubeNotConfiguredError extends Error {}

export async function fetchRecentUploads(maxResults = 50): Promise<ChannelVideo[]> {
  const [key, channel] = await Promise.all([
    readSetting('youtubeApiKey'),
    readSetting('youtubeChannelId'),
  ]);

  if (!key || !channel) {
    throw new YouTubeNotConfiguredError(
      'Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID to link uploads automatically.',
    );
  }

  // A channel's uploads playlist id is its channel id with the UC prefix
  // replaced by UU. Documented by YouTube, and stable.
  const uploadsPlaylist = channel.replace(/^UC/, 'UU');

  const url = new URL(UPLOADS_ENDPOINT);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('playlistId', uploadsPlaylist);
  url.searchParams.set('maxResults', String(maxResults));
  url.searchParams.set('key', key);

  const response = await fetch(url, {
    // This runs on a schedule and reads a feed that changes; a cached answer
    // would mean an upload waits for the cache to expire rather than the next
    // poll, which is the whole thing we are trying to make prompt.
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`YouTube API returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    items?: Array<{ snippet?: { description?: string; resourceId?: { videoId?: string } } }>;
  };

  return (body.items ?? [])
    .map((item) => ({
      videoId: item.snippet?.resourceId?.videoId ?? '',
      description: item.snippet?.description ?? '',
    }))
    .filter((video) => video.videoId);
}
