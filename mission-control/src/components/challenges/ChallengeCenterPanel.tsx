'use client';

import { Blocks } from 'lucide-react';
import type { Challenge } from '@/core/domain/entities/Challenge';
import { MobileSearch } from '@/components/layout/MobileSearch';
import { MissionFeed } from '@/components/mission-feed/MissionFeed';

interface ChallengeCenterPanelProps {
  challenge: Challenge;
  onLoadMore: () => void;
}

/**
 * The workspace's center panel, branching on the challenge's workspaceKind.
 *
 * 'embedded-platform' renders the REAL mission feed - the same MissionFeed
 * component the home page renders - rather than a lookalike, so "search the
 * real platform" is literally true. Its search box and filter chips live in
 * the navbar above (NavbarSearch/MobileSearch already read from the same
 * SearchContext this page is inside), which is why the instructions panel
 * points the learner up at the bar rather than into this panel.
 *
 * 'blockly-sim' is a placeholder for now - Level 2/3 challenges reuse
 * BlocklyEditor + SimulationPanel exactly as /mission does, landing with
 * their step content.
 */
export function ChallengeCenterPanel({ challenge, onLoadMore }: ChallengeCenterPanelProps) {
  if (challenge.workspaceKind === 'embedded-platform') {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="mx-auto w-full max-w-page pt-1">
          <MobileSearch />
        </div>
        <MissionFeed onLoadMore={onLoadMore} />
      </div>
    );
  }

  return (
    <div className="panel flex h-full w-full flex-col items-center justify-center gap-2 border border-border/60 bg-card/40 p-8 text-center clay">
      <Blocks className="h-8 w-8 text-muted-foreground" />
      <p className="font-display text-base font-bold text-foreground">Blockly workspace coming soon</p>
      <p className="text-sm text-muted-foreground">This challenge&rsquo;s building canvas isn&rsquo;t wired up yet.</p>
    </div>
  );
}
