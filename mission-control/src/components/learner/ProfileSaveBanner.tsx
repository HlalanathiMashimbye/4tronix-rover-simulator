'use client';

import { useState } from 'react';
import { useLearner } from '@/contexts/LearnerContext';
import { SaveProfileModal } from './SaveProfileModal';
import { RestoreProfileModal } from './RestoreProfileModal';

export function ProfileSaveBanner() {
  const { profileSaved } = useLearner();
  const [showSave, setShowSave] = useState(false);
  const [showRestore, setShowRestore] = useState(false);

  if (profileSaved) return null;

  return (
    <>
      <div className="hidden flex-col gap-3 rounded-[20px] border border-border/60 bg-muted px-5 py-4 sm:flex sm:flex-row sm:items-center">
        <div className="min-w-0 shrink-0">
          <p className="font-semibold text-foreground">Profile not saved yet</p>
          <p className="text-sm text-muted-foreground">
            Save it to keep your missions.
          </p>
        </div>
        <div className="flex shrink-0 gap-3 sm:ml-auto">
          <button
            type="button"
            onClick={() => setShowSave(true)}
            className="flex h-11 flex-1 items-center justify-center rounded-full bg-foreground px-5 text-sm font-semibold text-background focus:outline-none focus:ring-2 focus:ring-foreground/20 sm:flex-none"
          >
            Save my profile
          </button>
          <button
            type="button"
            onClick={() => setShowRestore(true)}
            className="flex h-11 flex-1 items-center justify-center rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20 sm:flex-none"
          >
            Restore a profile
          </button>
        </div>
      </div>

      <SaveProfileModal open={showSave} onClose={() => setShowSave(false)} />
      <RestoreProfileModal
        open={showRestore}
        onClose={() => setShowRestore(false)}
      />
    </>
  );
}
