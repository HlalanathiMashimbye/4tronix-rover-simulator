'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Bot, ChevronDown, ExternalLink, Map as MapIcon, Volume2, VolumeX } from 'lucide-react';

import type { RunOption } from '@/lib/missionRuns';
import { formatDuration, measuredSeconds } from '@/lib/missionDuration';
import type { TrajectoryPoint } from '@/lib/simulateCommands';
import type { CommandSource } from '@/lib/roverBlockly';
import { RoverSimulator } from '@/components/mission/RoverSimulator';
import { YouTubeEmbed } from '@/components/mission/YouTubeEmbed';
import { readStoredSound, serverSoundSnapshot, setMuted, subscribeToSound } from '@/hooks/soundPreference';

/**
 * Everything there is to watch for one mission, as a feed: the simulation,
 * then each time a rover drove it, newest first. One tile each, all of them on
 * the page, and the feed scrolls when there are more than fit.
 *
 * WHY A FEED. The simulation and the rover's videos shared one frame with
 * arrows, and whichever was behind the arrows got missed. First it was the
 * rover (David, 27 August 2026), so the rover went first; then it was the
 * simulation (David, 10 October 2026), behind the rover. Any control that
 * shows one hides the others. So nothing chooses: the page is built for
 * finding things, and a learner sees what exists by looking.
 *
 * EVERY TILE IS THE SHAPE OF ITS PICTURE. The simulation's is the yard's and
 * a video's is 4:3, which is what the yard's camera records. Two earlier cuts
 * put them in frames of other shapes and filled the difference: black bars
 * beside the yard, then a card of small print beside it. Both read as the
 * layout apologising. A tile that fits its picture has nothing left over.
 *
 * The simulation comes first because it is the one the code on this page is
 * about: its playhead is what lights the running line (AB#450). `codeSlot` is
 * where a phone puts that code, under the simulation, closed until asked for.
 * While it is open (`codeOpen`) the videos are folded away and the feed does
 * not scroll, so the simulation stays put above the line it is running.
 *
 * WHERE THERE IS ROOM FOR THREE COLUMNS (lib/missionLayout decides, and why)
 * the simulation stands beside the videos instead of above them, the videos
 * scroll in a column of their own, and `videosFoot` is what the page puts
 * under them: the operator's note, which is about the rover's run and so sits
 * with the rover's video. The tree is the same either way, so nothing that is
 * playing restarts when a window is resized across the line.
 *
 * How the tiles are sized and how the columns are, is in globals.css (.runFeed).
 */
export function RunFeed({
  runs,
  missionName,
  trajectory,
  simDuration,
  onSimSourceChange,
  onSimFinished,
  yardId,
  codeSlot,
  codeOpen = false,
  videosFoot,
}: {
  /** The rover's runs, newest first. Empty for a mission no rover has driven. */
  runs: RunOption[];
  missionName: string;
  trajectory: TrajectoryPoint[];
  /** How long the program runs, said beside the simulation that runs it. */
  simDuration: string;
  /** What the simulation is running, so the page can light up the code (AB#450). */
  onSimSourceChange?: (source: CommandSource | null) => void;
  /** The simulation has been watched to its end. */
  onSimFinished?: () => void;
  /** The yard the mission ran in, for the simulator to draw (AB#468). */
  yardId?: string;
  /** The code, on a phone: it sits under the simulation rather than beside the feed. */
  codeSlot?: ReactNode;
  /** The phone's code is open: fold the videos away and hold the simulation still. */
  codeOpen?: boolean;
  /** What sits under the videos where they have a column to themselves. */
  videosFoot?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const muted = useSyncExternalStore(subscribeToSound, readStoredSound, serverSoundSnapshot);
  const [simRunning, setSimRunning] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);

  // How many videos are still to come, further down. A video counts as in
  // view once half of it is. Less than that, a caption or a strip of sand
  // showing under the video before it, says that a video exists; the pill is
  // still what says how many and takes a learner there, and the review of 13
  // October 2026 asked for it at every size. One that has been scrolled past
  // is not counted either.
  //
  // Counted afresh on every scroll and every change of size, so the pill that
  // says so comes back when a learner scrolls back. It used to go for good at
  // the first scroll, on the theory that by then they knew, and a learner back
  // at the top had nothing to say there was more (the user's review, 13
  // October 2026).
  //
  // "In view" is what shows of the videos' own box inside the feed's. In one
  // feed the videos' box is as long as they are and the feed is what cuts it
  // off; in three columns the videos' box is the one that scrolls. What the
  // two have in common is what a learner can see, either way.
  const [below, setBelow] = useState(0);
  // What the pill last had to say. It fades out once nothing is further on,
  // and read "0 more videos" while it did.
  const [lastBelow, setLastBelow] = useState(1);
  useEffect(() => {
    const feed = feedRef.current;
    const rest = restRef.current;
    if (!feed || !rest) return;
    const measure = () => {
      const fold = Math.min(feed.getBoundingClientRect().bottom, rest.getBoundingClientRect().bottom);
      const further = [...rest.querySelectorAll('.runFeedTile')].filter((tile) => {
        const at = tile.getBoundingClientRect();
        return at.top > fold - at.height / 2;
      }).length;
      setBelow(further);
      if (further > 0) setLastBelow(further);
    };
    const frame = requestAnimationFrame(measure);
    // Scroll events do not bubble, and which of the two scrolls is the
    // layout's business.
    feed.addEventListener('scroll', measure, { passive: true });
    rest.addEventListener('scroll', measure, { passive: true });
    // The feed's own box, and everything in it: the simulation's tile changes
    // height when the yard's real shape arrives, which moves every video
    // without resizing the feed.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(feed);
    for (const child of feed.children) observer?.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      feed.removeEventListener('scroll', measure);
      rest.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [runs.length]);

  // Opening the code brings the simulation back to the top, where the code
  // then sits under it.
  useEffect(() => {
    const feed = feedRef.current;
    if (!codeOpen || !feed) return;
    // Not every webview has scrollTo on an element; all of them have scrollTop.
    if (typeof feed.scrollTo === 'function') feed.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    else feed.scrollTop = 0;
  }, [codeOpen, reduceMotion]);

  const moreShown = below > 0 && !codeOpen;
  /** To the first video not yet in view. */
  const showMore = () => {
    const tiles = restRef.current?.querySelectorAll('.runFeedTile') ?? [];
    tiles[runs.length - below]?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    // data-more: there is a video after the first. The layout then leaves
    // room to show it: the next one's caption under the first (globals.css).
    <div className="runFeedWrap" data-more={runs.length > 1 ? '' : undefined}>
      <div
        ref={feedRef}
        className="runFeed"
        data-code-open={codeOpen ? '' : undefined}
        // The feed is a list a keyboard can scroll, like any other that overflows.
        tabIndex={0}
        role="group"
        aria-label="Simulation and rover videos"
      >
        <FeedTile
          index={0}
          label="Simulation"
          detail="What your code says"
          tone="sim"
          icon={<MapIcon className="h-3.5 w-3.5" />}
          live={simRunning}
          aside={
            <span className="font-mono text-[11px] text-muted-foreground" title="How long it runs">
              {simDuration}
            </span>
          }
        >
          <div className="runFeedSim">
            <RoverSimulator
              trajectory={trajectory}
              isPlaying
              editorMode="code"
              bare
              frameless
              onSourceChange={onSimSourceChange}
              onFinished={onSimFinished}
              onRunningChange={setSimRunning}
              yardId={yardId}
            />
          </div>
        </FeedTile>

        {codeSlot}

        {/* Folds to nothing while the phone's code is open (globals.css). The
            inner box is what a grid row of 0fr can squeeze. In three columns
            this is the videos' column, and it is what scrolls. */}
        <div ref={restRef} className="runFeedRest" aria-hidden={codeOpen || undefined}>
          <div className="runFeedRestInner">
            {runs.map((run, index) => (
              <RoverRunTile
                key={run.id}
                run={run}
                // Newest first on screen, numbered in the order they were driven.
                number={runs.length - index}
                of={runs.length}
                index={index + 1}
                missionName={missionName}
                muted={muted}
              />
            ))}
          </div>
        </div>

        {/* Says there is more, and takes them to it. A pill rather than a
            scrollbar: a phone shows no scrollbar until a finger is already on
            the list, and a learner who does not know there is a video does
            not put one there.

            Inside the feed so that three columns can stand it in the videos'
            one. It does not scroll with the feed for being here: it is placed
            against the wrap, which does not move. */}
        {runs.length > 0 && (
          <button
            type="button"
            onClick={showMore}
            tabIndex={moreShown ? 0 : -1}
            aria-hidden={!moreShown}
            data-shown={moreShown ? '' : undefined}
            className="runFeedMore clay clay-press"
          >
            <ChevronDown className="runFeedMoreArrow h-3.5 w-3.5" />
            {moreLabel(lastBelow, runs.length)}
          </button>
        )}

        {videosFoot && (
          <motion.div
            className="runFeedFoot"
            // After the last tile, as the last thing in the order to look in.
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 240, damping: 22, delay: 0.08 + (runs.length + 1) * 0.09 }
            }
          >
            {videosFoot}
          </motion.div>
        )}
      </div>
    </div>
  );
}

/** What the pill says: how many videos are below, and whether any is already in view. */
export function moreLabel(below: number, of: number): string {
  if (below < of) return below === 1 ? '1 more video' : `${below} more videos`;
  return of === 1 ? 'Rover video' : `${of} rover videos`;
}

/**
 * One thing to watch: a caption that names it, and its picture underneath at
 * the picture's own shape.
 *
 * The name is a caption above the picture, not a chip over it. A chip sat on
 * the yard's top-left corner, which is where rock R1 is.
 */
function FeedTile({
  index,
  label,
  detail,
  tone,
  icon,
  live = false,
  aside,
  children,
}: {
  /** Its place in the feed, which is the order the tiles arrive in. */
  index: number;
  label: string;
  detail: string;
  tone: 'sim' | 'rover';
  icon: ReactNode;
  /** It is playing right now: the badge gets a dot. */
  live?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      aria-label={`${label}: ${detail}`}
      className="runFeedTile clay overflow-hidden rounded-2xl border border-border/70 bg-card"
      // They arrive one after another, top first, so the eye is led down the
      // feed once: the order they land in is the order to watch them in.
      initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 240, damping: 22, delay: 0.08 + index * 0.09 }
      }
    >
      <header className="flex h-9 items-center gap-2 px-2.5">
        <span
          className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            tone === 'sim'
              ? 'bg-amber-400/25 text-amber-700 dark:text-amber-300'
              : 'bg-primary/15 text-primary'
          }`}
        >
          {icon}
          {live && <span className="live-dot absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />}
        </span>
        <h2 className="shrink-0 font-display text-sm font-bold text-foreground">{label}</h2>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{detail}</p>
        {aside}
      </header>
      {children}
    </motion.section>
  );
}

/** A time a rover drove it: where and when, and the video. */
function RoverRunTile({
  run,
  number,
  of,
  index,
  missionName,
  muted,
}: {
  run: RunOption;
  number: number;
  of: number;
  index: number;
  missionName: string;
  muted: boolean;
}) {
  // What it actually took, when the record is believable (lib/missionDuration).
  const took = measuredSeconds(run.startedAt, run.completedAt);
  const detail = [run.label, of > 1 ? `run ${number} of ${of}` : null, took === null ? null : formatDuration(took)]
    .filter(Boolean)
    .join(' · ');

  return (
    <FeedTile
      index={index}
      label="Real rover"
      detail={detail}
      tone="rover"
      icon={<Bot className="h-3.5 w-3.5" />}
      aside={
        <span className="flex shrink-0 items-center gap-0.5">
          {/* The sound choice is about the learner's surroundings, not about
              one run: it holds for whichever video they play next, and for
              their next visit. */}
          <IconButton
            label={muted ? 'Unmute rover videos' : 'Mute rover videos'}
            title={muted ? 'Sound off. Videos will stay muted.' : 'Sound on'}
            pressed={muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </IconButton>
          {run.youtubeId && (
            <a
              href={`https://www.youtube.com/watch?v=${run.youtubeId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open this video on YouTube"
              title="Open on YouTube"
              className="runFeedIconButton"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </span>
      }
    >
      <div className="runFeedVideo">
        {run.videoUrl ? (
          <video
            controls
            muted={muted}
            preload="metadata"
            poster={run.thumbnailUrl}
            className="h-full w-full bg-black object-contain"
            aria-label={`${run.label} rover run video`}
          >
            <source src={run.videoUrl} />
          </video>
        ) : run.youtubeId ? (
          <YouTubeEmbed
            youtubeId={run.youtubeId}
            title={`${missionName}: ${run.label}`}
            showFallbackLink={false}
            muted={muted}
            fill
          />
        ) : null}
      </div>
    </FeedTile>
  );
}

function IconButton({
  label,
  title,
  pressed,
  onClick,
  children,
}: {
  label: string;
  title: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      className="runFeedIconButton"
    >
      {children}
    </button>
  );
}

/** For the page, which sets the yard's shape on the box the feed is sized in. */
export function yardShapeStyle(yardAspect: number): CSSProperties {
  return { '--yard-aspect': yardAspect } as CSSProperties;
}
