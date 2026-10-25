/**
 * A YouTube video, known by its id.
 *
 * Reading an id out of a pasted link, and building the watch and poster-frame
 * addresses back from one, were done in five places: two regex parsers that
 * disagreed about what an id is, and three hand-built URLs. The card accepted
 * links the operator's attach command refused, and drew a broken thumbnail for
 * them. This is the one definition of all of it.
 */

/** YouTube's poster frames: `mq` is 320x180, `hq` is 480x360. */
export type ThumbnailSize = 'mq' | 'hq';

// Every id YouTube issues is 11 characters. Checking the length is what turns
// "something after v=" into "a video", which a pasted link needs and an id
// YouTube's own API returned does not.
const ID_LENGTH = 11;
const LINK_PATTERN = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;

export class YouTubeVideoId {
  private constructor(readonly value: string) {}

  /** An id that came from YouTube itself (an upload result, a channel listing). */
  static of(id: string): YouTubeVideoId {
    return new YouTubeVideoId(id);
  }

  /** The video a watch, share or embed link points at, or null when it does not point at one. */
  static fromUrl(url: string | null | undefined): YouTubeVideoId | null {
    if (!url) return null;
    const match = url.match(LINK_PATTERN);
    return match && match[2].length === ID_LENGTH ? new YouTubeVideoId(match[2]) : null;
  }

  watchUrl(): string {
    return `https://www.youtube.com/watch?v=${this.value}`;
  }

  /** img.youtube.com is allow-listed in next.config.ts remotePatterns. */
  thumbnailUrl(size: ThumbnailSize): string {
    return `https://img.youtube.com/vi/${this.value}/${size}default.jpg`;
  }

  equals(other: YouTubeVideoId | null): boolean {
    return other !== null && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
