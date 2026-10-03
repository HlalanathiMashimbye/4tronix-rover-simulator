import { MissionWorkspace } from '@/components/mission/MissionWorkspace';
import { Suspense } from 'react';

export default function MissionPage() {
  return (
    // Pinned to the viewport at every size. On a phone this used to grow and
    // scroll, which put the simulator a screen away from the blocks (AB#455).
    // data-surface tells globals.css there is no tab bar to keep clear of
    // here; the navbar drops it on this page (lib/appSurfaces.ts).
    <main data-surface="build" className="relative h-page overflow-hidden px-3 py-1.5">
      {/* flex-col, not space-y: the workspace below sizes itself from what is
          left after this header, rather than the grid guessing at how tall the
          chrome above it is. */}
      <div className="mx-auto flex h-full min-h-0 max-w-page flex-col gap-1.5">
        {/* Not on a phone: two lines of title cost the canvas ~60px there,
            and the editor tabs below already say what this page is. */}
        <header className="hidden shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 md:flex">
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
