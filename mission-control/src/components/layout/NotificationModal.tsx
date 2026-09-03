/**
 * Notification Modal Component
 *
 * Shows notifications for:
 * - Completed missions (green)
 * - New missions to explore (orange)
 *
 * Notifications arrive via props; the Navbar currently passes an empty list
 * until the backend feed is wired up, so learners see the empty state.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, X } from 'lucide-react';

// Kept in sync with the transition durations below - see EmailPrompt for
// why the exit needs this rather than an instant unmount.
//
// This is deliberately plain CSS, not Motion's AnimatePresence: tried it
// (three different structures - a keyed array of siblings, a nested
// motion.div wrapper, two independent AnimatePresence blocks) and all three
// exhibited the same bug in this exact React 19 / Next 16 / motion@12.43.0
// combination, verified in a clean production build with real clicks: the
// exit animation completes correctly (opacity/scale reach their exact target
// values), but the component never actually unmounts - leaving an invisible,
// still-interactive layer sitting over the page, capable of eating clicks
// meant for whatever's underneath. Shipping that would be worse than the
// plain conditional render this replaced. Revisit if a newer `motion`
// release fixes it.
const EXIT_MS = 200;

interface CompletedNotification {
  type: 'completed';
  /** Mission id, so a single notification can be dismissed by hand. */
  id: string;
  missionName: string;
  completedAt: string; // ISO timestamp; rendered as "2 hours ago"
}

interface NewMissionNotification {
  type: 'new-mission';
  id: string;
  missionName: string;
  message: string;
}

type Notification = CompletedNotification | NewMissionNotification;

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications?: Notification[];
  /** Remove one notification. Opening the panel already clears the dot; this
      is the manual way out when something stays put anyway. */
  onDismiss?: (id: string) => void;
}

/** "2 hours ago" from an ISO timestamp. Kept local: the only other relative
    time in the app formats mission cards and carries their wording. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function NotificationModal({
  isOpen,
  onClose,
  notifications = [],
  onDismiss,
}: NotificationModalProps) {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  // Mount immediately, flip visible a frame later so the transition has a
  // "before" state to run from, and hold the unmount until the exit
  // animation has actually played.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the panel
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      {/* Modal - anchored to the bell in the top-right, so it scales in from
          that corner rather than its own centre (the default origin is
          wrong for anything anchored to a trigger; a centered scale would
          read as materializing out of nowhere instead of opening from the
          bell). */}
      <div
        className={`fixed top-20 right-4 z-50 w-[350px] origin-top-right overflow-hidden rounded-2xl border border-border bg-card shadow-2xl clay transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header.
            A theme toggle used to sit here so mobile could reach one at all -
            the bottom tab bar is a tight 4-slot layout. It was the wrong home:
            opening notifications is not asking to change appearance, and a
            control that switches the whole page's look has no business hiding
            behind a bell. It now lives in the mobile top bar, which had space
            all along. */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-bold text-foreground">Notifications</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close notifications"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Notifications List */}
        <div className="max-h-[500px] divide-y divide-border overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No new notifications
            </div>
          ) : (
            notifications.map((notification) => (
              <div key={notification.id} className="group relative">
                {/* The whole row is a link to the mission.
                    It used to be a plain div, so the notification told a
                    learner their run had finished and then left them to find
                    it: back to the feed, scroll, and hope they recognised the
                    name. The thing the notification is about is one tap away,
                    so it should be one tap. Closing the panel is part of the
                    same gesture - a modal still sitting over the page you just
                    navigated to is its own small bug. */}
                {notification.type === 'completed' && (
                  <Link
                    href={`/missions/${notification.id}`}
                    onClick={onClose}
                    className="flex items-center gap-2 bg-green-600/90 p-4 pr-10 text-white transition-colors hover:bg-green-600"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 text-sm font-semibold">
                        A mission finished on the rover
                      </p>
                      <p className="text-sm opacity-90">
                        <span className="font-medium">{notification.missionName}</span> was
                        completed {relativeTime(notification.completedAt)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                  </Link>
                )}

                {/* Not a link: this one is about the feed as a whole, and its
                    id does not name a mission to open. */}
                {notification.type === 'new-mission' && (
                  <div className="bg-orange-500/90 p-4 pr-10 text-white">
                    <p className="mb-1 text-sm font-semibold">
                      New Missions to Explore!
                    </p>
                    <p className="text-sm opacity-90">
                      {notification.message}
                    </p>
                  </div>
                )}

                {onDismiss && (
                  <button
                    onClick={(e) => {
                      // The row behind this is a link now. Without these the
                      // X would dismiss the notification and navigate to the
                      // mission at the same time.
                      e.preventDefault();
                      e.stopPropagation();
                      onDismiss(notification.id);
                    }}
                    // Always visible, not hover-revealed: this is the fallback
                    // for when the automatic clear has not worked, and a
                    // fallback nobody can find is not one.
                    className="absolute right-2 top-3 rounded-full p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                    aria-label={`Dismiss notification for ${notification.missionName}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
