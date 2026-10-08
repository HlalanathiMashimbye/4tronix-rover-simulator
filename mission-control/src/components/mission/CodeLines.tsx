'use client';

import { useEffect, useRef } from 'react';
import type { CommandSource } from '@/lib/roverBlockly';

/**
 * The mission's Python, with the line the simulation is running lit up, as in
 * the editor (AB#450). Lines rather than one block of text so a single line
 * can carry the highlight.
 */
export function CodeLines({ code, highlight }: { code: string; highlight: CommandSource | null }) {
  const preRef = useRef<HTMLPreElement>(null);
  // Trailing blank lines only: trimming the start would shift every line
  // number against the simulation's, which counts from the very first line.
  const lines = (code.trimEnd() || '# No code').split('\n');
  const from = highlight?.fromLine;
  const to = highlight?.toLine ?? from;

  // Follow the running line, as the editor does: on a phone the code has half
  // the screen, and a run went on below it with nothing lit in view. Scrolls
  // this box only, by the least that shows the line; scrollIntoView would
  // scroll the page around it as well.
  useEffect(() => {
    const pre = preRef.current;
    const line = pre?.querySelector<HTMLElement>('.rover-running-line');
    if (!pre || !line) return;
    const margin = line.offsetHeight;
    if (line.offsetTop < pre.scrollTop) pre.scrollTop = Math.max(0, line.offsetTop - margin);
    else if (line.offsetTop + line.offsetHeight > pre.scrollTop + pre.clientHeight) {
      pre.scrollTop = line.offsetTop + line.offsetHeight + margin - pre.clientHeight;
    }
  }, [from]);

  return (
    // relative: the lines' offsetTop is then measured from this box.
    <pre ref={preRef} className="relative min-h-0 flex-1 overflow-auto py-3 text-xs leading-relaxed text-foreground">
      <code>
        {lines.map((line, i) => {
          const running = from !== undefined && to !== undefined && i + 1 >= from && i + 1 <= to;
          return (
            <span key={i} className={`block px-4 ${running ? 'rover-running-line' : ''}`}>
              {line || ' '}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
