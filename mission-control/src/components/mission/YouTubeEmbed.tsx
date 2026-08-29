'use client';

/**
 * Click-to-play YouTube embed.
 *
 * The iframe is only created after the learner taps play. Three reliability
 * wins over an eager embed:
 * - Pages full of eager embeds from one venue IP (500 kids on shared wifi)
 *   look like bot traffic to Google and trigger "unusual traffic" blocks.
 *   Click-to-play means embeds load only on intent.
 * - The preview thumbnail comes from img.youtube.com, a separate pipeline
 *   that is practically never bot-gated, so the page always renders.
 * - The block page cannot be detected from our side (it loads "successfully"
 *   cross-origin and a captcha cannot be solved inside an embed), so a
 *   visible Watch-on-YouTube link is the escape hatch: the real site or app
 *   can pass the check.
 *
 * Uses the youtube-nocookie.com privacy-enhanced player, the right default
 * for an audience of minors.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Play, ExternalLink } from 'lucide-react';

interface YouTubeEmbedProps {
  youtubeId: string;
  title: string;
  showFallbackLink?: boolean;
  /** Start muted, and follow the learner's choice while playing (AB#409). */
  muted?: boolean;
}

export function YouTubeEmbed({
  youtubeId,
  title,
  showFallbackLink = true,
  muted = false,
}: YouTubeEmbedProps) {
  const [playing, setPlaying] = useState(false);
  // The mute setting AS IT WAS when play was tapped, frozen deliberately.
  // Deriving the URL from the live value would rewrite src on every toggle,
  // and rewriting an iframe's src reloads it: the video would jump back to the
  // start every time someone reached for the speaker button.
  const [startedMuted, setStartedMuted] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

  // Muting happens TWICE, on purpose, and neither way is redundant.
  //
  // `mute=1` in the URL is what makes the video start silent. It is the only
  // thing that can, because the player reads it before any script of ours could
  // reach it, and an autoplaying video that blares for half a second before
  // being silenced is exactly the failure this is meant to prevent.
  //
  // postMessage is what makes the toggle work WHILE the video plays. Changing
  // the URL instead would remount the iframe and restart the video from the
  // beginning, which is a rough thing to do to someone who just wanted quiet.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;

    frame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: muted ? 'mute' : 'unMute', args: [] }),
      'https://www.youtube-nocookie.com',
    );
  }, [muted, playing]);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        {playing ? (
          <iframe
            ref={frameRef}
            // enablejsapi is what allows the postMessage above to be heard.
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&autoplay=1&enablejsapi=1${startedMuted ? '&mute=1' : ''}`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setStartedMuted(muted);
              setPlaying(true);
            }}
            aria-label={`Play video: ${title}`}
            className="group absolute inset-0 h-full w-full cursor-pointer"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed img.youtube.com host; a plain img keeps the facade dependency-free */}
            <img
              src={`https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/10">
              <span className="clay flex h-14 w-14 items-center justify-center rounded-full bg-gradient-mars text-primary-foreground transition-transform group-hover:scale-110">
                <Play className="ml-0.5 h-6 w-6 fill-current" />
              </span>
            </span>
          </button>
        )}
      </div>
      {showFallbackLink && (
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-end text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Open on YouTube
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
