'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, Code2 } from 'lucide-react';

import type { Mission } from '@/core/domain/entities/Mission';
import type { CommandSource } from '@/lib/roverBlockly';
import { missionClipboardText } from '@/lib/missionClipboard';
import { BlocklyViewer } from '@/components/mission/BlocklyViewer';
import { CodeLines } from '@/components/mission/CodeLines';

/**
 * A mission's code, with the line the simulation is running lit up.
 *
 * Beside the feed where there is room for both. On a phone there is not, and
 * the pictures come first there (RunFeed), so it is `collapsible`: a bar under
 * the simulation that says it is there, closed until a learner asks for it.
 * Under the simulation rather than anywhere else because the simulation is
 * what runs it: a rover's video is not timed to the code, and lighting lines
 * under one would be a guess.
 *
 * Closed, nothing below the bar is rendered. The block viewer sizes its
 * program to its box, and in a box of no height it sized it to nothing.
 *
 * `footer` is set into the foot of the card, under the code. Beside the feed
 * or the videos' column that is where the page puts the operator's note and
 * Remix: as a bar across the foot of a tablet's or a laptop's page the note
 * went unseen, and the review of 13 October 2026 reported that those sizes
 * had no operator's note at all. The two share a line where the card is wide
 * enough and stack where it is not. A phone keeps them as a bar of its own,
 * and so does not hand this one a foot.
 */
export function MissionCode({
  mission,
  highlight,
  collapsible = false,
  open = true,
  onToggle,
  footer,
  tourId,
}: {
  mission: Mission;
  highlight: CommandSource | null;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  footer?: ReactNode;
  tourId?: string;
}) {
  const [view, setView] = useState<'blocks' | 'python'>('blocks');
  const [copied, setCopied] = useState(false);
  const hasBlocks = !!mission.blocklyState;
  const showBlocks = hasBlocks && view === 'blocks';
  const shown = !collapsible || open;

  const copyCode = async () => {
    // The same payload the operator queue copies. This button used to write
    // bare mission.code, which pasted into the run station as an anonymous
    // block of Python: no name, no id, and so no run id for the recording.
    try {
      await navigator.clipboard.writeText(missionClipboardText(mission));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section
      aria-label="Code"
      className="missionCode flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/60"
      data-collapsible={collapsible ? '' : undefined}
      data-open={shown ? '' : undefined}
      data-tour-id={tourId}
    >
      <div className={`flex h-11 shrink-0 items-center gap-2 px-2.5 ${shown ? 'border-b border-border/50' : ''}`}>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls="mission-code-body"
            className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-400/20 text-sky-700 dark:text-sky-300">
              <Code2 className="h-3.5 w-3.5" />
            </span>
            <span className="shrink-0 font-display text-sm font-bold text-foreground">Code</span>
            {!open && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                See the line behind each move
              </span>
            )}
            <ChevronDown
              className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[var(--ease-spring)] ${
                open ? 'rotate-180' : ''
              }`}
            />
          </button>
        ) : (
          !hasBlocks && (
            <div className="flex flex-1 items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400/70" />
              <span className="h-2 w-2 rounded-full bg-amber-400/70" />
              <span className="h-2 w-2 rounded-full bg-green-400/70" />
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                mission.py
              </span>
            </div>
          )
        )}

        {shown && hasBlocks && (
          <div
            // p-px, not p-0.5: rounded-lg is 14.4 and the buttons are
            // rounded-md at 12.4, so the track between them has to be 2px
            // (1px border + 1px padding) for the corners to stay
            // concentric. At p-0.5 it was a pixel out.
            className={`inline-flex shrink-0 rounded-lg border border-border bg-card p-px text-xs font-semibold ${
              collapsible ? '' : 'mr-auto'
            }`}
          >
            <button
              onClick={() => setView('blocks')}
              aria-pressed={showBlocks}
              className={`rounded-md px-3 py-1 transition-colors ${showBlocks ? 'bg-gradient-mars text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Blocks
            </button>
            <button
              onClick={() => setView('python')}
              aria-pressed={!showBlocks}
              className={`rounded-md px-3 py-1 transition-colors ${showBlocks ? 'text-muted-foreground hover:text-foreground' : 'bg-gradient-mars text-primary-foreground'}`}
            >
              Python
            </button>
          </div>
        )}

        {shown && (
          <button
            onClick={copyCode}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {shown && (
        <div id="mission-code-body" className="flex min-h-0 flex-1 flex-col">
          {showBlocks ? (
            <div className="min-h-0 flex-1">
              <BlocklyViewer
                state={mission.blocklyState!}
                highlight={highlight}
                // The whole program, as big as reads well: centred at the
                // editor's zoom, a short one sat small in a big white
                // canvas and a long one ran off the bottom.
                fit
                maxFitScale={1.25}
                zoomControls
              />
            </div>
          ) : (
            <CodeLines code={mission.code} highlight={highlight} />
          )}
        </div>
      )}

      {footer && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/50 p-2">{footer}</div>
      )}
    </section>
  );
}
