/**
 * The yards an operator can choose to work at.
 *
 * A yard is a physical place with a rover in it. Which one an operator is
 * standing next to is a fact about this afternoon, not a property of their
 * account, so it is chosen at sign-in rather than granted.
 *
 * There was briefly a yardIds custom claim assigning operators to yards. The
 * sponsor rejected it on 2026-08-27: needing an admin to re-issue a claim
 * before a facilitator can help at a different venue is exactly the friction
 * this platform exists to remove.
 *
 * ONE YARD TODAY, and the list is honest about that rather than pretending to
 * be a directory. When a second exists, this becomes a read of the
 * satellites/{yardId} heartbeat documents, so the list reflects yards that are
 * actually online rather than yards someone remembered to add here.
 */

export interface Yard {
  /**
   * Stable key. Never shown to anyone, and never changed.
   *
   * It reads like a machine name because that is what it is. It is stamped on
   * every mission document ever submitted and configured on the satellite
   * itself, so renaming it would mean migrating live learner data to make an
   * internal string prettier. The names below are what people read; this is
   * what the system matches on.
   */
  id: string;

  /** The venue. What an adult would call the place. */
  name: string;

  /** The suburb, for people who know the city. */
  area: string;

  /**
   * The city, and the whole point of showing any of this.
   *
   * A child wants to know their program ran on a real robot in a real place:
   * Cape Town, or Durban, or Limpopo. That is the sentence worth telling them,
   * and it is what makes a rover in a science centre feel bigger than a
   * simulator in a browser.
   */
  city: string;
}

export const KNOWN_YARDS: Yard[] = [
  {
    id: 'uct-rover-1',
    name: 'Cape Town Science Centre',
    area: 'Observatory',
    city: 'Cape Town',
  },
];

export const DEFAULT_YARD_ID = KNOWN_YARDS[0].id;

/** Where the operator's chosen yard is remembered, per browser. */
export const YARD_STORAGE_KEY = 'operator-yard';

export function isKnownYard(yardId: string): boolean {
  return KNOWN_YARDS.some((y) => y.id === yardId);
}

export function findYard(yardId: string | undefined): Yard | undefined {
  return KNOWN_YARDS.find((y) => y.id === yardId);
}

/**
 * The venue and suburb: "Cape Town Science Centre, Observatory".
 *
 * Returns null for a yard we do not recognise, and callers omit the line
 * rather than substituting the id. Showing a child "uct-rover-1" is worse than
 * showing them nothing: it is noise they cannot act on, and it leaks an
 * internal key into a page built for nine-year-olds.
 */
export function yardLabel(yardId: string | undefined): string | null {
  const yard = findYard(yardId);
  return yard ? `${yard.name}, ${yard.area}` : null;
}

/**
 * Just the city: "Cape Town".
 *
 * For anywhere short - a card, a chip, a run heading. This is the part a
 * learner actually cares about once there is more than one yard, because it is
 * what answers "where did my mission run".
 */
export function yardPlace(yardId: string | undefined): string | null {
  return findYard(yardId)?.city ?? null;
}

/**
 * The yard this browser last worked at.
 *
 * Deliberately per-browser rather than per-account: the tablet at the venue
 * should stay on that venue's yard no matter who signs into it, and an
 * operator who works at two places should not have to re-pick on the machine
 * that never moves.
 *
 * Falls back to the default rather than to nothing, so a fresh browser at a
 * single-yard deployment needs no decision at all. An unrecognised stored value
 * (a yard that has been retired) also falls back rather than leaving the
 * console pointed at somewhere that no longer exists.
 */
export function readStoredYard(): string {
  if (typeof window === 'undefined') return DEFAULT_YARD_ID;

  try {
    const stored = window.localStorage.getItem(YARD_STORAGE_KEY);
    return stored && isKnownYard(stored) ? stored : DEFAULT_YARD_ID;
  } catch {
    // Private browsing, or storage disabled. A yard selection is not worth
    // failing a page load over.
    return DEFAULT_YARD_ID;
  }
}

export function storeYard(yardId: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(YARD_STORAGE_KEY, yardId);
  } catch {
    // Same: the selection just will not persist.
  }
}

/*
 * A tiny store so React can read the selection with useSyncExternalStore.
 *
 * Reading localStorage into state inside an effect is the older pattern and
 * React 19 flags it: it renders once with the wrong value, then again with the
 * right one. useSyncExternalStore is built for exactly this, taking a separate
 * server snapshot so SSR and hydration agree.
 *
 * The `storage` event only fires in OTHER tabs, so same-tab changes are
 * announced here explicitly. Without that, choosing a yard would update
 * localStorage and leave this tab rendering the previous value.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToYard(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', listener);
    }
  };
}

/** The snapshot React uses on the server, and for the first client render. */
export function serverYardSnapshot(): string {
  return DEFAULT_YARD_ID;
}

export function selectYard(yardId: string): void {
  storeYard(yardId);
  for (const listener of listeners) listener();
}
