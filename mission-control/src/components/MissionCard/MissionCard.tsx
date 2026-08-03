'use client';

import Link from 'next/link';
import { Play, Rocket } from 'lucide-react';
import { Mission } from '@/core/domain/entities/Mission';
import { getDiscoveryStatus, DISCOVERY_BADGE_CLASS } from '@/lib/discoveryStatus';

function getYouTubeId(url: string | undefined): string | null {
  if (!url) return null;
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Human-friendly run time: "8s" or "1:23". */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "2 Aug 2026" - shorter and less ambiguous than 02/08/2026. */
function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const PEEK_LINES = 4;

/**
 * The first few meaningful lines, always padded to PEEK_LINES.
 *
 * The padding is what keeps every card the same height: a two-line mission and
 * a twenty-line one both render a four-line block, so the grid stays even
 * without a magic pixel height that would have to be retuned alongside the
 * font size.
 */
function codePeek(code: string): string {
  const lines = code
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  const peek = lines.length > 0 ? lines.slice(0, PEEK_LINES) : ['# No code'];
  // A non-breaking space, not an empty string: a trailing "\n" at the end of a
  // <pre> renders no line box at all, so empty padding lines silently did
  // nothing and short missions came out one line shorter than the rest.
  while (peek.length < PEEK_LINES) peek.push(' ');
  return peek.join('\n');
}

interface MissionCardProps {
  mission: Mission;
  /** Show the learner identifier - intended for operator views */
  showLearnerId?: boolean;
}

/**
 * Learner-facing mission card, laid out like a video listing: a 16:9 tile with
 * the status and run time over it, then the title and details underneath.
 *
 * The tile is always there, generic art when the mission has no recording yet,
 * so every card in the grid is exactly the same size.
 *
 * Always uses the discovery status (Completed / Pending) so a learner never
 * sees their mission as "Failed"; links through to the full mission detail
 * page.
 */
export function MissionCard({ mission }: MissionCardProps) {
  const discoveryStatus = getDiscoveryStatus(mission.status);
  const videoUrl = mission.youtubeUrl || mission.videoUrl;
  const youtubeId = getYouTubeId(videoUrl);
  const thumbnailUrl = youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null;
  const durationMs = mission.executionMetadata?.duration_ms;

  return (
    <Link
      href={`/missions/${mission.id}`}
      // Hover lift/zoom/highlight are gated to devices that actually have a
      // mouse. Touch fires :hover on tap, so on the tablets this platform
      // runs on, tapping a card was lifting it, zooming its thumbnail, and
      // recoloring its title as a side effect of the tap - and it could
      // stay "hover-stuck" until something else was touched.
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-[transform,border-color,box-shadow] duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:border-foreground/25 [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-secondary">
        {thumbnailUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail hosts vary per mission record; next/image would need remotePatterns per host */}
            <img
              src={thumbnailUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-105"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-foreground/10 opacity-0 transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card/90 shadow-sm">
                <Play className="ml-0.5 h-5 w-5 text-foreground" fill="currentColor" />
              </span>
            </div>
          </>
        ) : (
          // Generic placeholder art. Deliberately built from theme tokens and a
          // single icon rather than the illustrated rover that used to sit here
          // - that was hardcoded browns and oranges on a monochrome palette,
          // and it drew far more attention than an absent video deserves.
          // Mixed from --foreground rather than --accent: accent is a saturated
          // teal in dark mode, which turned every video-less tile into the
          // brightest thing on the page.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_38%,color-mix(in_oklab,var(--foreground)_9%,var(--secondary)),var(--secondary))] text-muted-foreground">
            <Rocket className="h-7 w-7 opacity-60" />
            <p className="text-[11px] font-semibold">
              {discoveryStatus === 'Pending' ? 'Recording on its way' : 'No video for this run'}
            </p>
          </div>
        )}

        <span
          className={`absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] shadow-sm ${DISCOVERY_BADGE_CLASS[discoveryStatus]}`}
        >
          {discoveryStatus}
        </span>

        {durationMs ? (
          <span className="absolute bottom-3 right-3 z-10 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white">
            {formatDuration(durationMs)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div>
          <h3 className="truncate font-display text-[15px] font-bold leading-snug text-foreground">
            {mission.name ?? `Mission-${mission.id.slice(0, 8)}`}
          </h3>
          {/* The yard id used to sit here ("uct-rover-1"). It is internal
              plumbing - a learner has no idea which yard they are on and it was
              the same string on every card. */}
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(mission.submittedAt)}</p>
        </div>

        {/* Code peek - no fake window chrome. The traffic-light dots were three
            more saturated colours competing with the status badge, on a surface
            whose whole point is to be quiet. */}
        <pre className="overflow-hidden rounded-xl border border-border/70 bg-secondary/50 px-3 py-2.5 font-mono text-[11px] leading-[1.7] text-muted-foreground">
          <code className="block truncate whitespace-pre">{codePeek(mission.code)}</code>
        </pre>
      </div>
    </Link>
  );
}
