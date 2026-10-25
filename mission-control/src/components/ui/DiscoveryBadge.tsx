import type { DiscoveryStatus } from '@/core/domain/services/discoveryStatus';

/**
 * The Completed / Pending pill on a mission card and a mission page.
 *
 * Its colours used to sit in core/domain beside the rule that decides the
 * status, so the Model carried Tailwind classes. The rule stays there; how it
 * looks is here. Callers pass the placement and size; the colour is the
 * status's.
 */
const COLOURS: Record<DiscoveryStatus, string> = {
  Completed: 'bg-emerald-500/85 text-emerald-950',
  Pending: 'bg-amber-300/85 text-amber-950',
};

export function DiscoveryBadge({ status, className }: { status: DiscoveryStatus; className: string }) {
  return <span className={`${className} ${COLOURS[status]}`}>{status}</span>;
}
