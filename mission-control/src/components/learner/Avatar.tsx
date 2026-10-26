'use client';

import dynamic from 'next/dynamic';
import type { LearnerAvatar } from '@/core/domain/entities/Learner';

const AvatarRenderer = dynamic(
  () => import('./AvatarRenderer').then((m) => m.AvatarRenderer),
  {
    ssr: false,
    loading: () => (
      <div className="inline-flex shrink-0 animate-pulse rounded-full bg-muted" />
    ),
  },
);

interface AvatarProps {
  avatar: LearnerAvatar | undefined;
  size?: number;
  className?: string;
}

export function Avatar({ avatar, size = 40, className = '' }: AvatarProps) {
  if (!avatar) {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 1 0-16 0" />
        </svg>
      </div>
    );
  }

  return <AvatarRenderer avatar={avatar} size={size} className={`overflow-hidden rounded-full ${className}`} />;
}
