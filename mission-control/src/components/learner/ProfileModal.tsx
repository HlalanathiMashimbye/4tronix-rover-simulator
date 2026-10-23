'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Dices, RefreshCw, X } from 'lucide-react';
import { useLearner } from '@/contexts/LearnerContext';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { Avatar } from './Avatar';
import { AvatarRenderer } from './AvatarRenderer';
import { SaveProfileModal } from './SaveProfileModal';
import { RestoreProfileModal } from './RestoreProfileModal';
import { buildGrid } from './AvatarPicker';
import { generateDisplayName, isGeneratedDisplayName } from '@/core/domain/services/displayNameGenerator';
import type { LearnerAvatar } from '@/core/domain/entities/Learner';
import { getLearnerID } from '@/infrastructure/browser/getLearnerID';

const EXIT_MS = 200;
const GRID_SIZE = 12;

interface Props {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export function ProfileModal({ open, onClose, triggerRef }: Props) {
  const [visible, setVisible] = useState(false);
  const [screen, setScreen] = useState<'profile' | 'edit'>('profile');
  const [showSave, setShowSave] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { learner, updateProfile, profileSaved } = useLearner();
  const { status, optIn, optOut, refresh } = useLeaderboard();
  const [saveError, setSaveError] = useState<string | null>(null);

  const learnerId = getLearnerID();
  const [editPage, setEditPage] = useState(0);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState<LearnerAvatar | null>(null);
  const editGrid = useMemo(
    () => buildGrid(learnerId, editPage, GRID_SIZE),
    [learnerId, editPage],
  );

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset screen on open
      setScreen('profile');
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    exitTimer.current = setTimeout(() => {}, EXIT_MS);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || showSave || showRestore) return;
      if (screen === 'edit') setScreen('profile');
      else {
        onClose();
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, screen, showSave, showRestore, onClose, triggerRef]);

  useEffect(() => {
    if (!visible || showSave || showRestore) return;
    const modal = modalRef.current;
    if (!modal) return;
    const getFocusable = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = getFocusable();
      if (!els.length) return;
      const first = els[0],
        last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    modal.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => {
      const els = getFocusable();
      if (els.length) els[0].focus();
    });
    return () => modal.removeEventListener('keydown', onKeyDown);
  }, [visible, screen, showSave, showRestore]);

  const handleClose = useCallback(() => {
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onClose, triggerRef]);

  const openEdit = useCallback(() => {
    const knownName = learner?.displayName || status?.displayName;
    setEditName(knownName && isGeneratedDisplayName(knownName) ? knownName : generateDisplayName());
    setEditAvatar(learner?.avatar ?? null);
    setEditPage(0);
    setSaveError(null);
    setScreen('edit');
  }, [learner, status]);

  const handleShuffle = useCallback(() => setEditPage((p) => p + 1), []);

  useEffect(() => {
    if (screen !== 'edit') return;
    if (!editAvatar) {
      setEditAvatar(editGrid[0].avatar);
      return;
    }
    const inGrid = editGrid.some(
      (o) =>
        o.avatar.style === editAvatar.style &&
        o.avatar.seed === editAvatar.seed,
    );
    if (!inGrid) setEditAvatar(editGrid[0].avatar);
  }, [editGrid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRerollName = useCallback(
    () => setEditName(generateDisplayName()),
    [],
  );

  const handleEditSave = useCallback(async () => {
    if (!editAvatar) return;
    setSaveError(null);
    const ok = await updateProfile(editName, editAvatar);
    if (ok) {
      await refresh();
      setScreen('profile');
    } else {
      setSaveError('Could not save — please try again.');
    }
  }, [editAvatar, editName, updateProfile, refresh]);

  const leaderboardOn = status?.optedIn ?? false;
  const toggleLeaderboard = useCallback(async () => {
    if (leaderboardOn) await optOut();
    else await optIn();
  }, [leaderboardOn, optIn, optOut]);

  if (!open && !visible) return null;

  const currentEditAvatar = editAvatar ?? editGrid[0].avatar;

  return (
    <>
      <div
        className={`fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center ${visible ? '' : 'pointer-events-none'}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          screen === 'profile' ? 'Your profile' : 'Edit astronaut ID'
        }
      >
        <div
          className={`absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
          onClick={handleClose}
        />
        <div
          ref={modalRef}
          className={`relative z-[101] w-full max-h-[90vh] overflow-y-auto rounded-t-3xl border border-border bg-card shadow-xl transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none sm:max-w-md sm:rounded-3xl ${
            visible
              ? 'translate-y-0 opacity-100 sm:scale-100'
              : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-3 sm:hidden" aria-hidden="true">
            <div className="h-1.5 w-10 rounded-full bg-border/60" />
          </div>

          <div className="p-6">
            {screen === 'profile' ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl font-bold text-foreground">
                    Your profile
                  </h2>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-5 flex items-center gap-3 rounded-2xl bg-muted p-4">
                  <Avatar avatar={learner?.avatar} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Astronaut ID
                    </div>
                    <div className="truncate font-display text-base font-bold text-foreground">
                      {learner?.displayName || status?.displayName || 'Unnamed'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openEdit}
                    className="flex h-10 items-center rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  >
                    Edit
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-muted p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      Show me on the leaderboard
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Others see your name and score.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={leaderboardOn}
                    onClick={toggleLeaderboard}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 ${
                      leaderboardOn ? 'bg-foreground' : 'bg-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        leaderboardOn ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-4 rounded-2xl bg-muted p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">
                      Keep your missions safe
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        profileSaved
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                      }`}
                    >
                      {profileSaved ? 'Saved' : 'Not saved'}
                    </span>
                  </div>
                  {!profileSaved && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Save your profile so you never lose your progress, or
                      restore one you saved before.
                    </p>
                  )}
                  <div className="mt-3 flex gap-3">
                    {!profileSaved && (
                      <button
                        type="button"
                        onClick={() => setShowSave(true)}
                        className="flex h-11 flex-1 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      >
                        Save my profile
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowRestore(true)}
                      className="flex h-11 flex-1 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    >
                      Restore a profile
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="flex h-12 w-full items-center justify-center rounded-full bg-blue-500 text-base font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 sm:hidden"
                  >
                    Done
                  </button>
                  <div className="hidden items-center justify-end gap-4 sm:flex">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded px-1 text-sm font-semibold text-foreground transition-colors hover:text-foreground/70 focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex h-10 items-center rounded-full bg-blue-500 px-6 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setScreen('profile')}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    aria-label="Back"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <h2 className="font-display text-xl font-bold text-foreground">
                    Edit astronaut ID
                  </h2>
                </div>

                <div className="mt-5 flex items-center gap-3 rounded-2xl bg-muted p-4">
                  <AvatarRenderer
                    avatar={currentEditAvatar}
                    size={48}
                    className="overflow-hidden rounded-full"
                  />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Astronaut ID
                    </div>
                    <div className="truncate font-display text-base font-bold text-foreground">
                      {editName || ' '}
                    </div>
                  </div>
                </div>

                <div className="mt-5">
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
                  <div className="grid grid-cols-6 gap-2">
                    {editGrid.map((option) => {
                      const isSelected =
                        option.avatar.style === currentEditAvatar.style &&
                        option.avatar.seed === currentEditAvatar.seed;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setEditAvatar(option.avatar)}
                          className={`flex items-center justify-center rounded-xl border-2 p-1 transition-all ${
                            isSelected
                              ? 'border-foreground bg-foreground/5'
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

                <div className="mt-5">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Your callsign
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
                    />
                    <button
                      type="button"
                      onClick={handleRerollName}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-foreground/20"
                      aria-label="Generate a new callsign"
                    >
                      <Dices className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {saveError && (
                  <p className="mt-4 text-center text-sm font-semibold text-destructive">
                    {saveError}
                  </p>
                )}

                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setScreen('profile')}
                    className="flex h-12 flex-1 items-center justify-center rounded-full border border-border text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-foreground/20 sm:flex-none sm:px-6"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleEditSave}
                    disabled={!editName.trim()}
                    className="flex h-12 flex-1 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-foreground/20 sm:flex-none sm:px-6"
                  >
                    Save
                  </button>
                </div>
              </>
            )}
          </div>
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
