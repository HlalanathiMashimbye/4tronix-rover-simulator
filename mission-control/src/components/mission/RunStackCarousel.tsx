'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, ExternalLink, Film, Play, Volume2, VolumeX } from 'lucide-react';

import { describeRuns, type RunOption } from '@/lib/missionRuns';
import type { TrajectoryPoint } from '@/lib/simulateCommands';
import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { YouTubeEmbed } from '@/components/mission/YouTubeEmbed';
import {
  readStoredSound,
  serverSoundSnapshot,
  setMuted,
  subscribeToSound,
} from '@/hooks/soundPreference';

/**
 * The run player: one frame that carries its own chrome.
 *
 * Everything a player needs to say used to sit AROUND the frame - a header
 * line, a mute button, a footer repeating the same run name, and a row of dots
 * underneath. Four bands of furniture stacked on a fixed-height panel, each
 * eating video height, and the run name printed twice within 400px of itself.
 * It read as a video with widgets parked near it rather than as a player.
 *
 * So the chrome is overlaid on the frame instead, which is both how players
 * look and how they use space: the media now gets the whole panel.
 *
 * The one thing that costs is the scrims landing exactly where both players
 * draw their own furniture: a native <video> puts its controls under the
 * bottom one, and both it and YouTube put a title under the top one. Hence
 * `playing`: the scrims fade the moment something starts, so nothing of ours
 * is ever stacked on the real controls, and they come back the moment it
 * stops. Bringing the top half back on hover was tried and reverted - two
 * titles in the same band is worse than none. The step arrows stay up
 * throughout: they sit at the vertical middle, the one band neither player
 * uses.
 */
export function RunStackCarousel({
  runs,
  selectedId,
  onSelect,
  missionName,
  trajectory,
}: {
  runs: RunOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  missionName: string;
  trajectory: TrajectoryPoint[];
}) {
  const reduceMotion = useReducedMotion();
  const muted = useSyncExternalStore(subscribeToSound, readStoredSound, serverSoundSnapshot);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [dragStart, setDragStart] = useState<number | null>(null);
  // WHICH run is playing, not whether one is. Storing the id rather than a
  // boolean is what makes stepping to another run reset this for free: the new
  // frame is a different piece of media, stopped, so its chrome is simply up.
  // A boolean needed an effect to clear it, which is a cascading render and a
  // way to leave the next frame bare if the reset is ever missed.
  const [playingRunId, setPlayingRunId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, runs.findIndex((run) => run.id === selectedId));
  const selectedRun = runs[selectedIndex] ?? runs[0];
  const canNavigate = runs.length > 1;
  const positionLabel = `${selectedIndex + 1} / ${runs.length}`;
  const playing = playingRunId === selectedRun.id;
  // Whether the media in the frame draws controls of its own right now, in
  // which case ours get out of the way rather than sit on top of them. A
  // playing video does; so does the simulator, always - it ships a full player
  // UI, a header and a Pause/Reset bar, in exactly the two bands the scrims
  // occupy. The arrows are unaffected: they sit at the vertical middle, which
  // nothing else uses.
  const mediaOwnsChrome = playing || selectedRun.kind === 'sim';

  const setPlaying = (isPlaying: boolean) => setPlayingRunId(isPlaying ? selectedRun.id : null);

  const visibleStack = useMemo(
    () =>
      Array.from({ length: Math.min(3, Math.max(0, runs.length - 1)) }, (_, i) => {
        const run = runs[(selectedIndex + i + 1) % runs.length];
        return { run, depth: i + 1 };
      }),
    [runs, selectedIndex],
  );

  const move = (step: 1 | -1) => {
    if (!canNavigate) return;
    setDirection(step);
    const nextIndex = (selectedIndex + step + runs.length) % runs.length;
    onSelect(runs[nextIndex].id);
  };

  const selectRun = (index: number) => {
    if (index === selectedIndex) return;
    setDirection(index > selectedIndex ? 1 : -1);
    onSelect(runs[index].id);
  };

  return (
    <section
      // flex-1 only from md up. That is where the page is pinned to the
      // viewport and a bounded height is what max-h-full below resolves
      // against. On a phone the page scrolls and nothing bounds it, so
      // claiming the leftover space just parked the frame in the middle of a
      // tall empty box.
      className="flex min-h-0 flex-col focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring md:flex-1"
      aria-roledescription="carousel"
      aria-label="Rover run videos"
      aria-describedby="run-carousel-status"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {/* The status line the carousel is described by. Kept as text of its own
          rather than pointing at the overlay, so it stays complete and in one
          piece however the visible chrome is arranged or faded. */}
      <p id="run-carousel-status" className="sr-only">
        {describeRuns(runs)}. Showing {selectedRun.label}, {selectedRun.sublabel}, {positionLabel}.
      </p>

      {/* The frame takes the shape of the footage rather than the shape of
          whatever space is going. Letting it absorb the column's full height
          made a 16:9 video sit in a 4:3 box with 300px of black above and
          below it, and pushed the stats under it off a page that does not
          scroll. Capped by height as well as width, so a short viewport
          narrows the frame instead of overflowing. */}
      <div className="flex min-h-0 items-center justify-center md:flex-1">
      <div
        className="relative aspect-video max-h-full w-full touch-pan-y"
        onPointerDown={(event) => {
          if (!canNavigate) return;
          setDragStart(event.clientX);
        }}
        onPointerUp={(event) => {
          if (dragStart === null) return;
          const delta = event.clientX - dragStart;
          setDragStart(null);
          if (Math.abs(delta) < 48) return;
          move(delta < 0 ? 1 : -1);
        }}
        onPointerCancel={() => setDragStart(null)}
      >
        {/* The rest of the stack, showing through behind the top card. Inset so
            the peeled corners read as depth rather than as a misaligned edge. */}
        <div className="pointer-events-none absolute inset-x-3 bottom-1 top-2" aria-hidden="true">
          {visibleStack.map(({ run, depth }) => (
            <div
              key={`${run.id}-${depth}`}
              className="absolute inset-0 rounded-2xl border border-border/50 bg-card/70 shadow-card"
              style={{
                transform: `translate(${depth * 9}px, ${depth * 11}px) scale(${1 - depth * 0.045}) rotate(${depth % 2 === 0 ? -1 : 1}deg)`,
                opacity: 0.58 - depth * 0.12,
                zIndex: 4 - depth,
              }}
            >
              <div className="h-full overflow-hidden rounded-2xl bg-muted/50">
                {run.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated YouTube poster URL for decorative stacked depth only.
                  <img src={run.thumbnailUrl} alt="" className="h-1/2 w-full object-cover opacity-35" />
                ) : (
                  <div className="flex h-1/2 items-center justify-center bg-gradient-to-br from-primary/20 to-transparent">
                    <Film className="h-7 w-7 text-primary/70" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <motion.article
          key={selectedRun.id}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * 38, rotate: direction * 1.5 }}
          animate={{ opacity: 1, x: 0, rotate: 0 }}
          transition={reduceMotion ? { duration: 0.08 } : { duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
          className="clay group/player absolute inset-0 z-10 overflow-hidden rounded-2xl border border-border/70 bg-black"
        >
          {/* The media owns the whole frame now; the chrome floats over it. */}
          <div className="absolute inset-0">
            {selectedRun.kind === 'real' && selectedRun.videoUrl ? (
              <video
                key={selectedRun.videoUrl}
                controls
                muted={muted}
                preload="metadata"
                poster={selectedRun.thumbnailUrl}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="h-full w-full bg-black object-contain"
                aria-label={`${selectedRun.label} rover run video`}
              >
                <source src={selectedRun.videoUrl} />
              </video>
            ) : selectedRun.kind === 'real' && selectedRun.youtubeId ? (
              <div className="flex h-full items-center justify-center">
                <YouTubeEmbed
                  youtubeId={selectedRun.youtubeId}
                  title={`${missionName}: ${selectedRun.label}`}
                  showFallbackLink={false}
                  muted={muted}
                  onPlayingChange={setPlaying}
                />
              </div>
            ) : (
              <div className="h-full p-2">
                <RoverSimulator trajectory={trajectory} isPlaying editorMode="code" />
              </div>
            )}
          </div>

          {/* Top scrim: what this collection is, and which of it you are on.
              Goes down while something plays, like the bottom one. */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-3 py-2.5 player-scrim-top transition-opacity duration-300 ${
              mediaOwnsChrome ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <p className="shrink-0 font-display text-[11px] font-semibold uppercase tracking-wider text-white/75">
              {describeRuns(runs)}
            </p>
            <p className="truncate font-display text-[11px] font-bold text-white">
              {selectedRun.label} · {selectedRun.sublabel} · {positionLabel}
            </p>
          </div>

          {/* Bottom scrim: the controls. Stays down while something plays,
              because this is exactly where the player's own controls live. */}
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 px-3 py-2.5 player-scrim-bottom transition-opacity duration-300 ${
              mediaOwnsChrome ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
          >
            {/* The sound choice is about the learner's surroundings, not about
                one run: it holds for whichever video they play next, and for
                their next visit. */}
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              aria-pressed={muted}
              aria-label={muted ? 'Unmute rover videos' : 'Mute rover videos'}
              title={muted ? 'Sound off. Videos will stay muted.' : 'Sound on'}
              className="clay-press pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/45 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/65 hover:text-white"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>

            {canNavigate && (
              <div
                className="pointer-events-auto flex flex-1 justify-center gap-1.5"
                role="tablist"
                aria-label="Choose a rover run"
              >
                {runs.map((run, index) => (
                  <button
                    key={run.id}
                    type="button"
                    role="tab"
                    aria-selected={index === selectedIndex}
                    aria-label={`Show ${run.label}, ${index + 1} of ${runs.length}`}
                    onClick={() => selectRun(index)}
                    className={`h-2 rounded-full transition-all ${
                      index === selectedIndex ? 'w-6 bg-white' : 'w-2 bg-white/45 hover:bg-white/75'
                    }`}
                  />
                ))}
              </div>
            )}

            <div className={`flex shrink-0 items-center gap-2 ${canNavigate ? '' : 'ml-auto'}`}>
              {selectedRun.kind === 'real' && (
                <span className="hidden items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[11px] font-bold text-white/90 backdrop-blur-sm sm:inline-flex">
                  <Play className="h-3 w-3 fill-current" />
                  Platform player
                </span>
              )}
              {selectedRun.youtubeId && (
                <a
                  href={`https://www.youtube.com/watch?v=${selectedRun.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold text-white/85 backdrop-blur-sm transition-colors hover:bg-black/65 hover:text-white"
                >
                  YouTube fallback
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          <NavButton direction="previous" disabled={!canNavigate} onClick={() => move(-1)} />
          <NavButton direction="next" disabled={!canNavigate} onClick={() => move(1)} />
        </motion.article>
      </div>
      </div>
    </section>
  );
}

/**
 * An edge-hugging step control.
 *
 * Small and quiet on purpose: at 44px on the outside of the frame these were
 * the heaviest thing in the panel, competing with the video for attention
 * while doing far less.
 */
function NavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === 'previous' ? 'Show previous rover run' : 'Show next rover run'}
      disabled={disabled}
      onClick={onClick}
      className={`clay-press absolute top-1/2 z-30 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-0 ${
        direction === 'previous' ? 'left-2' : 'right-2'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
