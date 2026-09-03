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
    // A child reading their own mission page used to see "curiosity".
    expect(yardLabel('curiosity')).toBe('Cape Town Science Centre, Observatory');
  });

  it('gives just the city for short spaces', () => {
    // "where did my mission run" is the question, and the city answers it.
    expect(yardPlace('curiosity')).toBe('Cape Town');
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

  it('uses the rover\'s own network name as the id', () => {
    // The rover answers to curiosity.local on the yard LAN, so a mission
    // tagged `curiosity` in Firestore points at a machine you can actually
    // ssh to. The old `uct-rover-1` matched nothing anyone could see.
    expect(KNOWN_YARDS[0].id).toBe('curiosity');
  });

  it('still resolves ids the yard used to have', () => {
    // Missions submitted before the rename carry `uct-rover-1`, and one stray
    // carries `cape-town`. A learner must not see a blank location because of
    // a rename they had nothing to do with.
    expect(yardLabel('uct-rover-1')).toBe('Cape Town Science Centre, Observatory');
    expect(yardLabel('cape-town')).toBe('Cape Town Science Centre, Observatory');
    expect(yardPlace('uct-rover-1')).toBe('Cape Town');
  });

  it('does not accept a former id as somewhere to write to', () => {
    // Lenient in what is read, strict in what is written. Displaying an old id
    // is kindness to existing data; writing a new mission to one would just
    // recreate the mess the migration cleaned up.
    expect(isKnownYard('curiosity')).toBe(true);
    expect(isKnownYard('uct-rover-1')).toBe(false);
  });
});
