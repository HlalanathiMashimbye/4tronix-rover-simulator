'use client';

import { useCallback, useMemo, useState } from 'react';
import { Dices, RefreshCw } from 'lucide-react';
import { AvatarRenderer } from './AvatarRenderer';
import { generateDisplayName } from '@/core/domain/services/displayNameGenerator';
import { AVATAR_STYLES, type LearnerAvatar } from '@/core/domain/entities/Learner';

const GRID_SIZE = 12;

interface AvatarOption {
  avatar: LearnerAvatar;
  key: string;
}

function buildGrid(learnerId: string, page: number): AvatarOption[] {
  const options: AvatarOption[] = [];
  const stylesPerSlot = Math.ceil(GRID_SIZE / AVATAR_STYLES.length);

  for (let i = 0; i < GRID_SIZE; i++) {
    const styleIndex = Math.floor(i / stylesPerSlot) % AVATAR_STYLES.length;
    const style = AVATAR_STYLES[styleIndex];
    const seed = `${learnerId}-${page}-${i}`;
    options.push({ avatar: { style, seed }, key: `${style}-${seed}` });
  }
  return options;
}

interface AvatarPickerProps {
  learnerId: string;
  initialAvatar?: LearnerAvatar;
  initialName?: string;
  onConfirm: (avatar: LearnerAvatar, displayName: string) => void;
}

export function AvatarPicker({
  learnerId,
  initialAvatar,
  initialName,
  onConfirm,
}: AvatarPickerProps) {
  const [page, setPage] = useState(0);
  const [displayName, setDisplayName] = useState(
    () => initialName || generateDisplayName(),
  );

  const grid = useMemo(() => buildGrid(learnerId, page), [learnerId, page]);

  const [selected, setSelected] = useState<LearnerAvatar>(
    () => initialAvatar || grid[0].avatar,
  );

  const handleShuffle = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  // When the page changes, auto-select the first option of the new grid
  // unless the user already has a selection that's still visible.
  const selectedInGrid = useMemo(
    () =>
      grid.some(
        (o) => o.avatar.style === selected.style && o.avatar.seed === selected.seed,
      ),
    [grid, selected],
  );

  const effectiveSelected = selectedInGrid ? selected : grid[0].avatar;
  if (!selectedInGrid && effectiveSelected !== selected) {
    setSelected(effectiveSelected);
  }

  const handleRerollName = useCallback(() => {
    setDisplayName(generateDisplayName());
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(selected, displayName);
  }, [onConfirm, selected, displayName]);

  return (
    <div className="w-full space-y-5">
      {/* Preview */}
      <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
        <AvatarRenderer avatar={effectiveSelected} size={48} className="overflow-hidden rounded-full" />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </div>
          <div className="truncate font-display text-base font-bold text-foreground">
            {displayName}
          </div>
        </div>
      </div>

      {/* Avatar grid */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Avatar
          </span>
          <button
            type="button"
            onClick={handleShuffle}
            className="flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            <RefreshCw className="h-3 w-3" />
            Shuffle
          </button>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {grid.map((option) => {
            const isSelected =
              option.avatar.style === effectiveSelected.style &&
              option.avatar.seed === effectiveSelected.seed;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelected(option.avatar)}
                className={`flex items-center justify-center rounded-xl border-2 p-2 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent bg-muted/40 hover:border-border hover:bg-muted/70'
                }`}
                aria-label={`Select ${option.avatar.style} avatar`}
                aria-pressed={isSelected}
              >
                <AvatarRenderer avatar={option.avatar} size={40} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Name */}
      <div>
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Name
        </span>
        <div className="flex items-center gap-2">
          <span className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-border/60 bg-background/70 px-3 text-sm font-medium text-foreground">
            {displayName}
          </span>
          <button
            type="button"
            onClick={handleRerollName}
            className="clay-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card text-foreground"
            title="Generate a new name"
            aria-label="Generate a new name"
          >
            <Dices className="h-4 w-4 text-primary" />
          </button>
        </div>
      </div>

      {/* Confirm */}
      <button
        type="button"
        onClick={handleConfirm}
        className="clay clay-press w-full rounded-xl bg-gradient-mars px-4 py-2.5 text-center text-sm font-bold text-primary-foreground"
      >
        Let&apos;s go!
      </button>
    </div>
  );
}
