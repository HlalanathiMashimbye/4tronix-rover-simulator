'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Home,
  MoreVertical,
  Moon,
  Play,
  SatelliteDish,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
} from 'lucide-react';

import { Menu, menuItemClass } from '@/components/ui/Menu';
import { SignOutButton } from '@/components/operator/SignOutButton';
import { YardChip } from '@/components/operator/YardChip';
import { useTheme } from '@/contexts/ThemeContext';
import type { Yard } from '@/core/domain/entities/Yard';
import { readConsoleUrl, YOUTUBE_STUDIO_URL } from '@/lib/yardConsole';

/**
 * The console's own top bar on a phone, replacing the learner navbar there.
 *
 * Measured at 390x844 (an iPhone 13), the learner navbar, this page's header
 * and its identity chips took 200px between them before the queue began, and
 * every control in that 200px was one an operator uses once a shift or never:
 * the brand, the learner's theme toggle, Manage access, Settings, Sign out.
 * The queue and the mission are what they use every minute.
 *
 * So below md the learner chrome is dropped (Navbar.tsx) and this bar stands
 * in: 52px, the title and where the operator is on the left, one overflow
 * menu on the right holding everything that was a pill. The menu is the
 * right home for those because none is a destination the operator moves
 * between - the destinations are the tab bar at the bottom of the screen.
 */
export function OperatorMobileBar({
  role,
  yard,
  isAdmin,
}: {
  role: 'operator' | 'admin';
  yard: Yard | null;
  isAdmin: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  // In an effect, not the initialiser: this renders on the server too.
  const [consoleUrl, setConsoleUrl] = useState<string>('');
  useEffect(() => setConsoleUrl(readConsoleUrl()), []);

  return (
    <div className="flex h-13 shrink-0 items-center gap-2 md:hidden">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-display text-base font-bold leading-tight tracking-tight text-foreground">
          Operator <span className="text-gradient-mars">Console</span>
        </h1>
        <p className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <ShieldCheck className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
          <span className="shrink-0">{role}</span>
          <span aria-hidden="true" className="shrink-0">·</span>
          <YardChip yard={yard} compact />
        </p>
      </div>

      <Menu label="More" icon={<MoreVertical className="h-5 w-5" />}>
        {/* The two doors first: of everything in here, these are the ones an
            operator opens during a run rather than once a shift. */}
        <a
          role="menuitem"
          href={consoleUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={menuItemClass}
        >
          <SatelliteDish className="h-4 w-4 text-primary" />
          Yard console
        </a>
        <a
          role="menuitem"
          href={YOUTUBE_STUDIO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={menuItemClass}
        >
          <Play className="h-4 w-4 fill-current text-muted-foreground" />
          YouTube Studio
        </a>

        {isAdmin && (
          <>
            <hr className="my-1 border-border/60" />
            <Link role="menuitem" href="/operator/team" className={menuItemClass}>
              <Users className="h-4 w-4 text-muted-foreground" />
              Manage access
            </Link>
            <Link role="menuitem" href="/operator/settings" className={menuItemClass}>
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              Settings
            </Link>
          </>
        )}

        <hr className="my-1 border-border/60" />
        <button type="button" role="menuitem" onClick={toggleTheme} className={menuItemClass}>
          {theme === 'dark' ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        {/* The learner site is still one tap away: the brand link that did
            this lives in the navbar this bar replaces. */}
        <Link role="menuitem" href="/" className={menuItemClass}>
          <Home className="h-4 w-4 text-muted-foreground" />
          Mission Control
        </Link>
        <SignOutButton variant="menu-item" />
      </Menu>
    </div>
  );
}
