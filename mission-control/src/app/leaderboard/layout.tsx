/**
 * Marks everything under /leaderboard as the Leaderboard surface, which
 * globals.css reads to swap in the kid-friendly palette and rounded reading
 * face — the same treatment /challenges gets. An attribute rather than a route
 * check for the same reason the other surfaces use one: the CSS never learns
 * the path.
 */
export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="leaderboard" className="contents">
      {children}
    </div>
  );
}
