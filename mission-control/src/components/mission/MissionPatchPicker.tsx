'use client';

import Image from 'next/image';
import { Dices } from 'lucide-react';
import { getRandomMissionPatch } from '@/lib/missionPatchGenerator';

interface MissionPatchPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function MissionPatchPicker({ value, onChange }: MissionPatchPickerProps) {
  const handleReroll = () => {
    onChange(getRandomMissionPatch());
  };

  return (
    <div className="flex items-center gap-1.5">
      <Image
        src={value}
        alt="Mission patch"
        width={36}
        height={36}
        className="h-9 w-9 rounded-full border border-border/60 object-cover"
      />
      <button
        onClick={handleReroll}
        className="clay-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-foreground"
        title="Pick a different mission patch"
        aria-label="Pick a different mission patch"
      >
        <Dices className="h-4 w-4 text-primary" />
      </button>
    </div>
  );
}
