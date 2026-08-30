'use client';

import { Dices } from 'lucide-react';
import { generateRandomMissionName } from '@/core/domain/services/missionNameGenerator';

interface MissionNameInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function MissionNameInput({ value, onChange }: MissionNameInputProps) {
  const handleGenerateRandom = () => {
    onChange(generateRandomMissionName());
  };

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
            empty outline in that gap. */}
        <span
          aria-labelledby="mission-name-label"
          className={`flex h-9 min-w-0 flex-1 items-center truncate rounded-lg border border-border/60 bg-background/70 px-2.5 text-xs ${
            value ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {value || 'Naming your mission…'}
        </span>
        <button
          onClick={handleGenerateRandom}
          className="clay-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-foreground"
          title="Generate a random mission name"
          aria-label="Generate a random mission name"
        >
          <Dices className="h-4 w-4 text-primary" />
        </button>
      </div>
    </div>
  );
}
