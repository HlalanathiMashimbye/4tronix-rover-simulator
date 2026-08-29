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
} from '@/lib/soundPreference';

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
  const selectedIndex = Math.max(0, runs.findIndex((run) => run.id === selectedId));
  const selectedRun = runs[selectedIndex] ?? runs[0];
  const canNavigate = runs.length > 1;
  const positionLabel = `${selectedIndex + 1} / ${runs.length}`;

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
      className="flex min-h-0 flex-1 flex-col gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
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
      <div className="flex shrink-0 items-center justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <p className="font-display text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {describeRuns(runs)}
          </p>
          <h2 id="run-carousel-status" className="truncate font-display text-sm font-bold text-foreground">
            {selectedRun.label} · {selectedRun.sublabel} · {positionLabel}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Sits in the header rather than on the card, because the choice is
              about the learner's surroundings, not about one run: it holds for
              whichever video they play next, and for their next visit. */}
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute rover videos' : 'Mute rover videos'}
            title={muted ? 'Sound off. Videos will stay muted.' : 'Sound on'}
            className="clay clay-press inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-card/60 text-muted-foreground transition-colors hover:border-primary/70 hover:text-foreground"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <span className="rounded-full border border-border/70 bg-card/60 px-2.5 py-1 font-mono text-[11px] font-bold text-muted-foreground">
            {positionLabel}
          </span>
        </div>
      </div>

      {/* items-STRETCH, not center. Centring left the card at its content
          height inside a 780px row, so two things went wrong at once: the panel
          was two thirds empty, and RoverSimulator - which sets canvas.height
          from a ResizeObserver on its wrapper - collapsed to a 41px sliver
          because nothing above it had a definite height to inherit. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <CarouselButton
          direction="previous"
          disabled={!canNavigate}
          onClick={() => move(-1)}
          className="order-2 hidden justify-self-start self-center sm:order-none sm:inline-flex"
        />

        <div
          className="relative min-h-[280px] w-full touch-pan-y px-1 pb-4 pt-1 sm:order-none sm:min-h-[360px] sm:px-3"
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
          <div className="absolute inset-x-4 bottom-0 top-7 sm:inset-x-8">
            {visibleStack.map(({ run, depth }) => (
              <div
                key={`${run.id}-${depth}`}
                aria-hidden="true"
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
            className="clay relative z-10 flex h-full min-h-[270px] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card"
          >
            <div className="min-h-0 flex-1 bg-black">
              {selectedRun.kind === 'real' && selectedRun.videoUrl ? (
                <video
                  key={selectedRun.videoUrl}
                  controls
                  muted={muted}
                  preload="metadata"
                  poster={selectedRun.thumbnailUrl}
                  className="h-full min-h-[210px] w-full bg-black object-contain"
                  aria-label={`${selectedRun.label} rover run video`}
                >
                  <source src={selectedRun.videoUrl} />
                </video>
              ) : selectedRun.kind === 'real' && selectedRun.youtubeId ? (
                <div className="flex h-full min-h-[210px] items-center">
                  <YouTubeEmbed
                    youtubeId={selectedRun.youtubeId}
                    title={`${missionName}: ${selectedRun.label}`}
                    showFallbackLink={false}
                    muted={muted}
                  />
                </div>
              ) : (
                <div className="h-full min-h-[260px] p-2">
                  <RoverSimulator trajectory={trajectory} isPlaying editorMode="code" />
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-background/65 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-bold text-foreground">{selectedRun.label}</p>
                <p className="truncate text-xs text-muted-foreground">{selectedRun.sublabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedRun.kind === 'real' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
                    <Play className="h-3 w-3 fill-current" />
                    Platform player
                  </span>
                )}
                {selectedRun.youtubeId && (
                  <a
                    href={`https://www.youtube.com/watch?v=${selectedRun.youtubeId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    YouTube fallback
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </footer>
          </motion.article>
        </div>

        <CarouselButton
          direction="next"
          disabled={!canNavigate}
          onClick={() => move(1)}
          className="order-3 hidden justify-self-end self-center sm:order-none sm:inline-flex"
        />
      </div>

      {canNavigate && (
        <div className="flex shrink-0 justify-center gap-1.5" role="tablist" aria-label="Choose a rover run">
          {runs.map((run, index) => (
            <button
              key={run.id}
              type="button"
              role="tab"
              aria-selected={index === selectedIndex}
              aria-label={`Show ${run.label}, ${index + 1} of ${runs.length}`}
              onClick={() => selectRun(index)}
              className={`h-2.5 rounded-full transition-all ${
                index === selectedIndex ? 'w-7 bg-primary' : 'w-2.5 bg-muted-foreground/35 hover:bg-muted-foreground/60'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CarouselButton({
  direction,
  disabled,
  onClick,
  className = '',
}: {
  direction: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={direction === 'previous' ? 'Show previous rover run' : 'Show next rover run'}
      disabled={disabled}
      onClick={onClick}
      // No display utility here on purpose. It used to hardcode inline-flex,
      // which collided with the `hidden` its callers pass on mobile - two
      // display utilities where the winner depends on Tailwind's stylesheet
      // order, not on the class string. The caller decides.
      className={`clay clay-press h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-card/90 text-foreground backdrop-blur transition-colors hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-35 ${className}`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
