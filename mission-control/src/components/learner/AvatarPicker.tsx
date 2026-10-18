'use client';

import { useCallback, useMemo, useState } from 'react';
import { Dices, RefreshCw } from 'lucide-react';
import { AvatarRenderer } from './AvatarRenderer';
import { generateDisplayName } from '@/core/domain/services/displayNameGenerator';
import { AVATAR_STYLES, type LearnerAvatar } from '@/core/domain/entities/Learner';
import { useIsPhoneLayout } from '@/hooks/useIsPhoneLayout';

const GRID_SIZE_SM = 9;
const GRID_SIZE_LG = 12;

interface AvatarOption {
  avatar: LearnerAvatar;
  key: string;
}

function buildGrid(learnerId: string, page: number, size: number): AvatarOption[] {
  const options: AvatarOption[] = [];
  const stylesPerSlot = Math.ceil(size / AVATAR_STYLES.length);

  for (let i = 0; i < size; i++) {
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
  onRestore?: () => void;
  confirmLabel?: string;
}

export function AvatarPicker({
  learnerId,
  initialAvatar,
  initialName,
  onConfirm,
  onRestore,
  confirmLabel = "Let’s go!",
}: AvatarPickerProps) {
  const isPhone = useIsPhoneLayout();
  const gridSize = isPhone ? GRID_SIZE_SM : GRID_SIZE_LG;

  const [page, setPage] = useState(0);
  const [displayName, setDisplayName] = useState(
    () => initialName || generateDisplayName(),
  );

  const grid = useMemo(() => buildGrid(learnerId, page, gridSize), [learnerId, page, gridSize]);

  const [selected, setSelected] = useState<LearnerAvatar>(
    () => initialAvatar || grid[0].avatar,
  );

  const handleShuffle = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

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
    <div className="w-full space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary p-3">
        <AvatarRenderer
          avatar={effectiveSelected}
          size={48}
          className="overflow-hidden rounded-full ring-2 ring-border"
        />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Astronaut ID
          </div>
          <div className="truncate font-display text-base font-bold text-foreground">
            {displayName}
          </div>
        </div>
      </div>

      {/* Avatar grid */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Choose your avatar
          </span>
          <button
            type="button"
            onClick={handleShuffle}
            className="flex items-center gap-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" />
            Shuffle
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {grid.map((option) => {
            const isSelected =
              option.avatar.style === effectiveSelected.style &&
              option.avatar.seed === effectiveSelected.seed;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelected(option.avatar)}
                className={`flex items-center justify-center rounded-xl border-2 p-1 transition-all md:p-1.5 ${
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent bg-secondary hover:bg-secondary/80'
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
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Your callsign
        </span>
        <div className="flex items-center gap-2">
          <span className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground">
            {displayName}
          </span>
          <button
            type="button"
            onClick={handleRerollName}
            className="clay-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-foreground transition-colors hover:bg-secondary"
            title="Generate a new name"
            aria-label="Generate a new name"
          >
            <Dices className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        {onRestore ? (
          <button
            type="button"
            onClick={onRestore}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            I have a recovery code
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={handleConfirm}
          className="clay clay-press rounded-xl bg-gradient-mars px-6 py-2.5 text-sm font-bold text-primary-foreground"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
