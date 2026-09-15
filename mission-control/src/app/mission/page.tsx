import { MissionWorkspace } from '@/components/mission/MissionWorkspace';
import { Suspense } from 'react';

export default function MissionPage() {
  return (
    // See MissionVideoClient for the full reasoning: pinned to the viewport
    // from md up, free to grow on a phone where the panels stack and a fixed
    // 100vh clips the simulator out of reach.
    <main className="relative px-3 py-1.5 md:h-[calc(100dvh-var(--app-chrome))] md:overflow-hidden">
      {/* flex-col, not space-y: the workspace below sizes itself from what is
          left after this header, rather than the grid guessing at how tall the
          chrome above it is. */}
      <div className="mx-auto flex h-full min-h-0 max-w-page flex-col gap-1.5">
        <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="font-display text-xl font-bold text-foreground md:text-2xl">
            Build your <span className="text-gradient-mars">Mission</span>
          </h1>
          <p className="text-xs text-muted-foreground md:text-sm">
            Drive it, snap blocks together, or write Python, then send it to a real rover.
          </p>
        </header>

        <Suspense fallback={<div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Loading workspace...</div>}>
          <MissionWorkspace />
        </Suspense>
      </div>
    </main>
  );
}
