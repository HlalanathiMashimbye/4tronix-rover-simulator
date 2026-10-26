'use client';

/**
 * Renders a DiceBear avatar from { style, seed } entirely in the browser.
 * No network request — the style packages draw the SVG locally.
 *
 * Lazy-loaded via next/dynamic so pages that never show an avatar do not
 * download the DiceBear chunk (~30 kB combined for three styles).
 */

import { useMemo } from 'react';
import { createAvatar } from '@dicebear/core';
import * as bottts from '@dicebear/bottts';
import * as identicon from '@dicebear/identicon';
import * as shapes from '@dicebear/shapes';
import type { LearnerAvatar, AvatarStyle } from '@/core/domain/entities/Learner';

const STYLE_MAP: Record<AvatarStyle, Parameters<typeof createAvatar>[0]> = {
  bottts: bottts as unknown as Parameters<typeof createAvatar>[0],
  identicon: identicon as unknown as Parameters<typeof createAvatar>[0],
  shapes: shapes as unknown as Parameters<typeof createAvatar>[0],
};

interface AvatarRendererProps {
  avatar: LearnerAvatar;
  size?: number;
  className?: string;
}

export function AvatarRenderer({ avatar, size = 40, className = '' }: AvatarRendererProps) {
  const dataUri = useMemo(() => {
    const style = STYLE_MAP[avatar.style as AvatarStyle];
    if (!style) return '';
    return createAvatar(style, { seed: avatar.seed, size }).toDataUri();
  }, [avatar.style, avatar.seed, size]);

  return (
    <img
      src={dataUri}
      width={size}
      height={size}
      className={`inline-flex shrink-0 ${className}`}
      alt=""
      aria-hidden="true"
    />
  );
}
