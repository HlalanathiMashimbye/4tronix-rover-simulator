/**
 * Marks everything under /challenges as the Challenges surface, which
 * globals.css reads to swap in the brighter palette and rounded reading face
 * (see docs/UI_REDESIGN_STANDARDS.md). An attribute rather than a route check
 * for the same reason the operator surface uses one: the CSS never learns the
 * path. display: contents keeps this wrapper out of the layout, and custom
 * properties and font-family still inherit through it.
 */
export default function ChallengesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="challenges" className="contents">
      {children}
    </div>
  );
}
