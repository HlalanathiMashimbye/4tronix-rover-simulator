/**
 * Yard selection.
 *
 * A yard is a choice, not a permission. This is what replaced the yardIds
 * claim the sponsor rejected on 2026-08-27, so the assertions here are mostly
 * about failing safely rather than about access.
 */

import {
  KNOWN_YARDS,
  yardLabel,
  yardPlace,
  findYard,
  DEFAULT_YARD_ID,
  YARD_STORAGE_KEY,
  isKnownYard,
  readStoredYard,
  storeYard,
} from '@/infrastructure/config/yards';

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((k: string) => store[k] ?? null),
  setItem: jest.fn((k: string, v: string) => {
    store[k] = v;
  }),
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  jest.clearAllMocks();
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  // @ts-expect-error restoring the server-side absence of window
  delete globalThis.window;
});

describe('readStoredYard', () => {
  it('returns a previously chosen yard', () => {
    store[YARD_STORAGE_KEY] = KNOWN_YARDS[0].id;

    expect(readStoredYard()).toBe(KNOWN_YARDS[0].id);
  });

  it('falls back to the default when nothing is stored', () => {
    // A single-yard deployment should need no decision at all.
    expect(readStoredYard()).toBe(DEFAULT_YARD_ID);
  });

  it('falls back when the stored yard is not one we know', () => {
    // A retired yard must not leave the console pointed at somewhere that no
    // longer exists.
    store[YARD_STORAGE_KEY] = 'durban-decommissioned';

    expect(readStoredYard()).toBe(DEFAULT_YARD_ID);
  });

  it('falls back when storage throws', () => {
    // Private browsing, or storage disabled. A yard selection is not worth
    // failing a page load over.
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(readStoredYard()).toBe(DEFAULT_YARD_ID);
  });

  it('returns the default on the server, where there is no window', () => {
    // @ts-expect-error simulating server-side rendering
    delete globalThis.window;

    expect(readStoredYard()).toBe(DEFAULT_YARD_ID);
  });
});

describe('storeYard', () => {
  it('remembers the choice for this browser', () => {
    // Per-browser, not per-account: the tablet at a venue stays on that
    // venue's yard whoever signs into it.
    storeYard(KNOWN_YARDS[0].id);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(YARD_STORAGE_KEY, KNOWN_YARDS[0].id);
  });

  it('does not throw when storage is unavailable', () => {
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => storeYard(KNOWN_YARDS[0].id)).not.toThrow();
  });
});

describe('isKnownYard', () => {
  it('accepts a configured yard and rejects anything else', () => {
    expect(isKnownYard(DEFAULT_YARD_ID)).toBe(true);
    expect(isKnownYard('not-a-yard')).toBe(false);
  });
});

describe('what a learner reads', () => {
  it('names the venue and suburb rather than an internal key', () => {
    // A child reading their own mission page used to see "uct-rover-1".
    expect(yardLabel('uct-rover-1')).toBe('Cape Town Science Centre, Observatory');
  });

  it('gives just the city for short spaces', () => {
    // "where did my mission run" is the question, and the city answers it.
    expect(yardPlace('uct-rover-1')).toBe('Cape Town');
  });

  it('shows nothing for a yard it does not recognise, never the id', () => {
    // Falling back to the id would leak an internal key onto a page built for
    // nine-year-olds, which is worse than showing nothing at all.
    expect(yardLabel('durban-rover-9')).toBeNull();
    expect(yardPlace('durban-rover-9')).toBeNull();
  });

  it('handles a mission with no yard at all', () => {
    expect(yardLabel(undefined)).toBeNull();
    expect(findYard(undefined)).toBeUndefined();
  });

  it('keeps the id stable and separate from the name', () => {
    // The id is stamped on every mission ever submitted and configured on the
    // satellite. Renaming it to something prettier would be a migration of
    // live learner data for a string nobody reads.
    expect(KNOWN_YARDS[0].id).toBe('uct-rover-1');
    expect(KNOWN_YARDS[0].name).not.toContain('uct-rover');
  });
});
