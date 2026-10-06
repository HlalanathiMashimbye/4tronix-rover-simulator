'use client';

import { useEffect, useRef, useState } from 'react';
import { Dices } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { generateRandomMissionName } from '@/core/domain/services/missionNameGenerator';

interface MissionNameInputProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * When the names on the way to the new one show, in ms from the press: quick
 * at first and slowing down, like a die coming to rest. The new name lands
 * after the last, as the die stops tumbling (.dice-roll in globals.css).
 */
const REEL_MS = [0, 70, 150, 240, 350];
const LAND_MS = 480;

export function MissionNameInput({ value, onChange }: MissionNameInputProps) {
  const reduceMotion = useReducedMotion();
  /** A name shown on the way to the new one, or null once it has landed. */
  const [passing, setPassing] = useState<string | null>(null);
  /** Goes up with each roll, which replays the die's tumble. */
  const [rolls, setRolls] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopReel = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => stopReel, []);

  // THE NAME IS CHANGED AT ONCE, and only the box plays catch-up. The roll is
  // for show: Send pressed mid-roll must send the name it lands on, not the
  // one it is rolling away from.
  const handleGenerateRandom = () => {
    onChange(generateRandomMissionName());
    stopReel();
    if (reduceMotion) {
      setPassing(null);
      return;
    }
    setRolls((n) => n + 1);
    timers.current = [
      ...REEL_MS.map((ms) => setTimeout(() => setPassing(generateRandomMissionName()), ms)),
      setTimeout(() => setPassing(null), LAND_MS),
    ];
  };

  const shown = passing ?? value;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span id="mission-name-label" className="sr-only">
          Mission name
        </span>
        {/* Generated, not typed: a learner can re-roll this but not edit it,
            so a mission can never be created unnamed.

            Empty only for the first moment after load, because the name is
            generated on mount rather than during render - see the comment in
            MissionWorkspace. The placeholder keeps the box from flashing as an
            empty outline in that gap.

            Each name rolls up into the box from below, as on a slot machine's
            reel; the last one lands with a bounce. Keyed by the name, so a new
            one replays the animation. */}
        <span
          aria-labelledby="mission-name-label"
          className={`flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-border/60 bg-background/70 px-2.5 text-xs ${
            shown ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          <span
            key={`${rolls}:${shown}`}
            data-name-reel={rolls === 0 ? undefined : passing !== null ? 'passing' : 'landed'}
            className="nameReel block truncate"
          >
            {shown || 'Naming your mission…'}
          </span>
        </span>
        <button
          onClick={handleGenerateRandom}
          className="clay-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-foreground"
          title="Generate a random mission name"
          aria-label="Generate a random mission name"
        >
          <Dices key={rolls} className={`h-4 w-4 text-primary ${rolls > 0 ? 'dice-roll' : ''}`} />
        </button>
      </div>
    </div>
  );
}
