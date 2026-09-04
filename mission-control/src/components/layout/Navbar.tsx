/**
 * Global Navigation Bar
 *
 * Desktop (md+): top bar with explicit Home and My History links,
 * a prominent "Create Mission" button, and the notification bell.
 * Mobile (< md): top bar shows logo + bell; the destinations move to a fixed
 * bottom tab bar (kid-friendly, always visible, no hidden hamburger menu).
 */

'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  Bell,
  Home,
  History as HistoryIcon,
  Plus,
  Sun,
  Moon,
  Trophy,
} from 'lucide-react';
import { useCallback, useState, type ComponentProps } from 'react';
import { NotificationModal } from './NotificationModal';
import { NavbarSearch } from './NavbarSearch';
import { EmailPrompt } from '@/components/learner/EmailPrompt';
import { useTheme } from '@/contexts/ThemeContext';
import { useCompletionNotifications } from '@/hooks/useCompletionNotifications';

const NAV_ITEMS = [
  { href: '/', label: 'Home', mobileLabel: 'Home', icon: Home },
  {
    href: '/history',
    label: 'My History',
    mobileLabel: 'History',
    // Not a plain Clock: the Pending filter chip sits a few pixels away in the
    // same bar and was using the same clock face.
    icon: HistoryIcon,
  },
  {
    href: '/leaderboard',
    label: 'Leaderboard',
    mobileLabel: 'Leaderboard',
    icon: Trophy,
  },
];

export function Navbar() {
  const pathname = usePathname();
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const { unread, hasUnread, markAllSeen, dismiss } = useCompletionNotifications();

  // What the open panel shows is captured when it opens, not read live.
  // Opening marks everything seen, so a live list would empty itself in front
  // of the learner as they looked at it.
  const [viewing, setViewing] = useState<
    ComponentProps<typeof NotificationModal>['notifications']
  >([]);

  const openNotifications = useCallback(() => {
    setViewing(unread.map((n) => ({ type: 'completed' as const, ...n })));
    setIsNotificationOpen(true);
    markAllSeen();
  }, [unread, markAllSeen]);

  const dismissNotification = useCallback(
    (id: string) => {
      dismiss(id);
      setViewing((prev) => (prev ?? []).filter((n) => n.id !== id));
    },
    [dismiss]
  );

  const isActive = (path: string): boolean => {
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(path + '/');
  };

  // Each destination is a segment inside a single pill-shaped nav group.
  const desktopLinkClass = (path: string): string => {
    // Deliberately smaller than the Create Mission button beside them: these
    // are wayfinding, that is the action, and at equal weight they competed.
    const base =
      'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors';
    const active = 'bg-gradient-mars text-primary-foreground clay';
    const inactive =
      'text-muted-foreground hover:text-foreground hover:bg-card/60';

    return `${base} ${isActive(path) ? active : inactive}`;
  };

  return (
    <>
      {/* Divider is an inset shadow (not border-b) so the bar stays exactly 64px
          tall, matching the h-[calc(100dvh-var(--app-chrome))] page mains (no 1px overflow). */}
      {/* The fill alone cannot separate this from the page: in Paper & Ink the
          card and the background are ~2% apart in lightness (0.99 vs 0.966),
          which measured 1.13:1 - not a band, just a smudge. A hairline plus a
          soft shadow underneath is what actually reads as a raised bar, and it
          works in both themes without touching the palette. The shadow is an
          OUTER one so the bar stays exactly 64px and the page mains below
          (h-[calc(100dvh-var(--app-chrome))]) do not overflow by a pixel. */}
      <nav className="sticky top-0 z-50 bg-card/90 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_-1px_0_0_var(--border),0_6px_20px_-14px_rgb(0_0_0/0.45)]">
        {/* Use a balanced three-column layout so the search sits in the true
            visual center of the navbar, with the brand and action cluster
            anchored to opposite edges. */}
        <div className="mx-auto grid h-16 max-w-page grid-cols-[auto_1fr_auto] items-center gap-3 px-4">
          {/* Logo / Brand (also links home) */}
          <Link href="/" className="group flex shrink-0 items-center gap-2.5 justify-self-start">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10 clay transition-transform duration-200 [@media(hover:hover)_and_(pointer:fine)]:group-hover:-translate-y-0.5">
              <Image
                src="/rover-hero.jpg"
                alt="Mars Rover"
                width={256}
                height={256}
                className="h-full w-full object-cover object-center"
                quality={100}
                priority
              />
            </div>
            <div className="leading-tight">
              <p className="whitespace-nowrap font-display text-lg font-bold tracking-tight text-foreground">
                Mission Control
              </p>
              <p className="flex items-center gap-1 whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                <span className="h-1 w-1 rounded-full bg-primary" />
                Sapient.rocks
              </p>
            </div>
          </Link>

          {/* Search sits BETWEEN brand and actions so the three read as one
              bar. Renders nothing when the current page registered no filters. */}
          <NavbarSearch />

          <div className="flex shrink-0 items-center justify-end gap-2 justify-self-end">
            {/* Desktop destinations - one segmented pill group */}
            <div className="hidden items-center gap-1 rounded-full border border-border/60 bg-card/40 p-1 md:flex">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className={desktopLinkClass(href)}>
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}

            </div>

            {/* Prominent primary action */}
            <Link
              href="/mission"
              className="clay clay-press hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-mars px-4 py-2 text-sm font-bold text-primary-foreground md:flex"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Create Mission
            </Link>

            {/* Theme toggle (desktop; mobile reaches it from the Notifications
                panel header - the bottom tab bar is a tight 4-slot layout
                that shouldn't grow a 5th icon). */}
            <button
              onClick={toggleTheme}
              className="hidden rounded-full border border-border/60 bg-card/40 p-2.5 text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground md:block"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* Mobile theme toggle. Lives here because the mobile top bar has
                nothing but the logo, so there is room - it used to be buried in
                the notifications panel, where pressing the bell surprised you
                with a theme switch. */}
            <button
              onClick={toggleTheme}
              className="rounded-full border border-border/60 bg-card/40 p-2 text-muted-foreground transition-colors hover:text-foreground md:hidden"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* Notification bell (desktop; mobile uses the bottom "Alerts" tab) */}
            <button
              onClick={openNotifications}
              className="relative hidden rounded-full border border-border/60 bg-card/40 p-2.5 text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground md:block"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {hasUnread && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-card/85 backdrop-blur-xl backdrop-saturate-150 md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 py-1.5">
          <Link
            href="/"
            className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-bold transition-colors ${
              isActive('/') ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Home className="h-5 w-5" />
            Home
          </Link>

          <Link
            href="/mission"
            className="flex flex-col items-center text-[10px] font-bold text-white"
            aria-label="Create Mission"
          >
            <span className="clay clay-press flex h-12 w-12 -translate-y-2 items-center justify-center rounded-2xl bg-gradient-mars ring-4 ring-background">
              <Plus className="h-6 w-6" strokeWidth={2.5} />
            </span>
          </Link>

          <Link
            href="/history"
            className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-bold transition-colors ${
              isActive('/history') ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <HistoryIcon className="h-5 w-5" />
            History
          </Link>

          <button
            onClick={openNotifications}
            className="relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[10px] font-bold text-muted-foreground transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            Alerts
            {hasUnread && (
              <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
            )}
          </button>
        </div>
      </nav>

      <NotificationModal
        isOpen={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
        notifications={viewing}
        onDismiss={dismissNotification}
      />

      <EmailPrompt />
    </>
  );
}