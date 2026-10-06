'use client';

import type { CommandSource } from '@/lib/roverBlockly';

/**
 * The mission's Python, with the line the simulation is running lit up, as in
 * the editor (AB#450). Lines rather than one block of text so a single line
 * can carry the highlight.
 */
export function CodeLines({ code, highlight }: { code: string; highlight: CommandSource | null }) {
  // Trailing blank lines only: trimming the start would shift every line
  // number against the simulation's, which counts from the very first line.
  const lines = (code.trimEnd() || '# No code').split('\n');
  const from = highlight?.fromLine;
  const to = highlight?.toLine ?? from;
  return (
    <pre className="min-h-0 flex-1 overflow-auto py-3 text-xs leading-relaxed text-foreground">
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
