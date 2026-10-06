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
        {/* A heading for screen readers only. On screen the editor tabs say
            what this page is, and a title row cost the page its height: on a
            phone ~60px of canvas, on a laptop ~40px of simulator, which is
            ~40px of its width too, since its yard keeps its real shape. */}
        <h1 className="sr-only">Build your mission</h1>

        <Suspense fallback={<div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Loading workspace...</div>}>
          <MissionWorkspace />
        </Suspense>
      </div>
    </main>
  );
}
