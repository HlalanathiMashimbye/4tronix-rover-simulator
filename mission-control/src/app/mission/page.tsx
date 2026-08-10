import { MissionWorkspace } from '@/components/mission/MissionWorkspace';
import { Suspense } from 'react';

export default function MissionPage() {
  return (
    // See MissionVideoClient for the full reasoning: pinned to the viewport
    // from md up, free to grow on a phone where the panels stack and a fixed
    // 100vh clips the simulator out of reach.
    <main className="relative px-3 py-2 md:h-[calc(100vh-64px)] md:overflow-hidden">
      <div className="mx-auto max-w-page space-y-2">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
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
