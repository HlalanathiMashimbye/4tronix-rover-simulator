/**
 * Global Navigation Bar
 *
 * Desktop (md+): top bar with the destinations, a prominent "Create Mission"
 * button, the theme toggle and the notification bell.
 * Mobile (< md): top bar shows logo, theme toggle and bell; every destination
 * moves to a fixed bottom tab bar (kid-friendly, always visible, no hidden
 * hamburger menu).
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
  Target,
  Trophy,
} from 'lucide-react';
import { useCallback, useState, type ComponentProps } from 'react';
import { NotificationModal } from './NotificationModal';
import { NavbarSearch } from './NavbarSearch';
import { EmailPrompt } from '@/components/learner/EmailPrompt';
import { useTheme } from '@/contexts/ThemeContext';
import { isOperatorSurface } from '@/lib/appSurfaces';
import { useCompletionNotifications } from '@/hooks/useCompletionNotifications';
import { useChallengeProgress } from '@/hooks/useChallengeProgress';

const NAV_ITEMS = [
  { href: '/', label: 'Home', mobileLabel: 'Home', icon: Home },
  {
    href: '/challenges',
    label: 'Challenges',
    mobileLabel: 'Challenges',
    // Not the Trophy: below xl these links are icons alone, and Challenges
    // and Leaderboard wearing the same one could not be told apart.
    icon: Target,
  },
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
  const { completedCount, totalCount, loading: challengesLoading } = useChallengeProgress();

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

  /**
   * On a phone, the operator console wears its own chrome and none of this.
   *
   * Below md this bar, the bottom tab bar and the floating Create Mission
   * button are the learner's: Home, History, the bell and a new mission are
   * places a child goes. They took 128px of an 844px screen from an operator
   * who goes to none of them, and the floating button sat over the corner
   * both console panes end in. OperatorMobileBar and OperatorTabBar stand in
   * for them there. From md up nothing changes: the desktop console uses the
   * search field in this bar.
   *
   * The route is named in lib/appSurfaces.ts rather than here - see the
   * note there for why this file must not contain the string.
   */
  const onOperatorSurface = isOperatorSurface(pathname);

  const isActive = (path: string): boolean => {
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(path + '/');
  };

  // Each destination is a segment inside a single pill-shaped nav group, and
  // a segment is its icon alone: the name is a tooltip and a screen-reader
  // label. Four labelled segments, Create Mission and two buttons measured
  // 700px, and at 1024px that pushed the cluster left over the search filters
  // and the brand. Create Mission keeps its words, as the one action here.
  const desktopLinkClass = (path: string): string => {
    // Deliberately smaller than the Create Mission button beside them: these
    // are wayfinding, that is the action, and at equal weight they competed.
    const base =
      'flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition-colors';
    const active = 'bg-gradient-mars text-primary-foreground clay';
    const inactive =
      'text-muted-foreground hover:text-foreground hover:bg-card/60';

    return `${base} ${isActive(path) ? active : inactive}`;
  };

  return (
    <>
      {/* Divider is an inset shadow (not border-b) so the bar stays exactly 64px
          tall, matching the h-page mains below (no 1px overflow). */}
      {/* The fill alone cannot separate this from the page: in Paper & Ink the
          card and the background are ~2% apart in lightness (0.99 vs 0.966),
          which measured 1.13:1 - not a band, just a smudge. A hairline plus a
          soft shadow underneath is what actually reads as a raised bar, and it
          works in both themes without touching the palette. The shadow is an
          OUTER one so the bar stays exactly 64px and the page mains below
          (h-page) do not overflow by a pixel. */}
      <nav
        className={`sticky top-0 z-50 bg-card/90 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_-1px_0_0_var(--border),0_6px_20px_-14px_rgb(0_0_0/0.45)] ${
          onOperatorSurface ? 'hidden md:block' : ''
        }`}
      >
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
                <Link key={href} href={href} title={label} className={desktopLinkClass(href)}>
                  <Icon className="h-4 w-4" />
                  <span className="sr-only">{label}</span>
                  {/* Progress pill: only Challenges carries one, and only once
                      a count has actually loaded - a "0/0" flash before the
                      hook resolves would read as broken, not empty. */}
                  {href === '/challenges' && !challengesLoading && totalCount > 0 && (
                    <span className="rounded-full bg-background/50 px-1.5 py-0.5 text-[9px] font-bold tabular-nums">
                      {completedCount}/{totalCount}
                    </span>
                  )}
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

            <button
              onClick={toggleTheme}
              className="rounded-full border border-border/60 bg-card/40 p-2 text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground md:p-2.5"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* The bell is up here on a phone too. It used to be the bottom
                bar's fourth slot, which left no room for the Leaderboard: a
                destination belongs in the tab bar, and a bell in the corner
                is where every app puts it. */}
            <button
              onClick={openNotifications}
              className="relative rounded-full border border-border/60 bg-card/40 p-2 text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground md:p-2.5"
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

      {/* Mobile bottom tab bar: every destination, as flat, equal-weight
          slots, read from NAV_ITEMS so a new page cannot be reachable on a
          laptop and missing on a phone - which is how the Leaderboard went
          missing here. Create Mission is deliberately NOT in this row: it is
          the floating button below, because an action and a destination
          should not look alike. */}
      {!onOperatorSurface && (
      <nav
        aria-label="Tabs"
        className="fixed bottom-0 left-0 right-0 z-50 h-[var(--app-bottom-chrome)] border-t border-border/50 bg-card/85 backdrop-blur-xl backdrop-saturate-150 md:hidden"
      >
        <div className="mx-auto flex h-full max-w-md items-center justify-around px-2">
          {NAV_ITEMS.map(({ href, mobileLabel, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-0.5 text-[10px] leading-none font-bold transition-colors ${
                isActive(href) ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              {mobileLabel}
              {href === '/challenges' &&
                !challengesLoading &&
                totalCount > 0 &&
                completedCount < totalCount && (
                  <span className="absolute right-1 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
                )}
            </Link>
          ))}
        </div>
      </nav>
      )}

      {/* Floating Create Mission button. Sits above and overlapping the tab
          bar rather than inside it - z-index above the bar, positioned so its
          bottom half rides over the bar's top edge, matching a standard FAB
          rather than the row's flat tabs. */}
      {!onOperatorSurface && (
        <Link
          href="/mission"
          aria-label="Create Mission"
          className="clay clay-press fixed bottom-10 right-4 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-mars text-primary-foreground ring-4 ring-background md:hidden"
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </Link>
      )}

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