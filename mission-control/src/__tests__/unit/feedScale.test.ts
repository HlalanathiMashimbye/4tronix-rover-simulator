/**
 * The feed at a realistic number of missions, not a handful (AB#410).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PAGINATION TESTS. Those prove the cursor
 * is correct, and they do it with a handful of documents, which is the right
 * size for pinning behaviour and the wrong size for answering "does this get
 * slower every week". The marker asked the second question, and nothing in the
 * suite answered it.
 *
 * The number that matters is READS PER PAGE. If it is constant, the feed costs
 * the same on the thousandth mission as on the first, and neither the bill nor
 * the latency grows with the archive. If it grows, the feed is quietly on a
 * timer. Firestore bills every document an offset skips over, so the difference
 * between the two designs is invisible in a small test and ruinous in a year.
 *
 * SCALE is deliberately bigger than the project has today. There were 121
 * missions at the end of August 2026 after two events, so a few thousand is a
 * year or two of ordinary use rather than a fantasy.
 */

import { FirestoreMissionRepository } from '@/infrastructure/persistence/FirestoreMissionRepository';

type Row = { id: string; data: Record<string, unknown> };

const SCALE = 2000;
const PAGE = 24; // FEED_SIZE in src/app/page.tsx
const ARCHIVE_SEARCH_PAGES = 20; // the cap on one "Search older missions" walk

function makeFirestore(rows: Row[], meter = { docsRead: 0, queries: 0 }) {
  const build = (state: { after?: [string, string]; max?: number }) => ({
    orderBy() {
      return build(state);
    },
    startAfter(submittedAt: string, id: string) {
      return build({ ...state, after: [submittedAt, id] });
    },
    limit(max: number) {
      return build({ ...state, max });
    },
    async get() {
      meter.queries += 1;
      let out = [...rows].sort((a, b) => {
        const byDate = String(b.data.submittedAt).localeCompare(String(a.data.submittedAt));
        return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
      });

      if (state.after) {
        const [ts, id] = state.after;
        const idx = out.findIndex((r) => r.data.submittedAt === ts && r.id === id);
        out = idx === -1 ? out : out.slice(idx + 1);
      }
      if (state.max !== undefined) out = out.slice(0, state.max);

      // Only what the query actually returns is billed. An offset design would
      // bill the skipped documents too, which is the whole point.
      meter.docsRead += out.length;
      return { docs: out.map((r) => ({ id: r.id, data: () => r.data })) };
    },
  });

  return { collection: () => build({}), meter };
}

/**
 * Deliberately lumpy timestamps. One in five missions shares its submittedAt
 * with its neighbour, which is what a busy event looks like: thirty children
 * pressing Send in the same minute. Ties are where a submittedAt-only cursor
 * silently drops or repeats rows, and at this scale it would be invisible on
 * screen and obvious only to the child whose mission vanished.
 */
function buildMissions(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${String(i).padStart(5, '0')}`,
    data: {
      yardId: 'curiosity',
      status: 'completed',
      code: 'rover.forward(50)',
      submittedAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 5) * 60_000).toISOString(),
    },
  }));
}

describe(`the feed at ${SCALE} missions`, () => {
  const rows = buildMissions(SCALE);

  it('walks every mission exactly once, with no gaps and no repeats', async () => {
    const db = makeFirestore(rows);
    const repo = new FirestoreMissionRepository(db as never);

    const seen: string[] = [];
    let cursor = undefined;
    let pages = 0;

    do {
      const page = await repo.findRecent(PAGE, cursor);
      seen.push(...page.missions.map((m) => m.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(seen).toHaveLength(SCALE);
    expect(new Set(seen).size).toBe(SCALE);
    expect(pages).toBe(Math.ceil(SCALE / PAGE));
  });

  it('costs the same per page on the last page as on the first', async () => {
    // The property that makes the feed survive growth. Constant reads per page
    // means the thousandth mission is as cheap to reach as the first.
    const db = makeFirestore(rows);
    const repo = new FirestoreMissionRepository(db as never);

    const firstPage = await repo.findRecent(PAGE);
    const readsForFirst = db.meter.docsRead;

    let cursor = firstPage.nextCursor ?? undefined;
    let lastPageReads = 0;
    while (cursor) {
      const before = db.meter.docsRead;
      const page = await repo.findRecent(PAGE, cursor);
      lastPageReads = db.meter.docsRead - before;
      cursor = page.nextCursor ?? undefined;
    }

    // limit + 1: the extra document is how the next page is detected without
    // paying for a separate count query.
    expect(readsForFirst).toBe(PAGE + 1);
    expect(lastPageReads).toBeLessThanOrEqual(PAGE + 1);
  });

  it('reads only what it shows, rather than the whole collection', async () => {
    const db = makeFirestore(rows);
    const repo = new FirestoreMissionRepository(db as never);

    await repo.findRecent(PAGE);

    // The regression this guards is findAll(), which fetched 100 documents to
    // render 24 and then ran a count query per queued mission. At this scale
    // that is the difference between 25 reads and thousands.
    expect(db.meter.docsRead).toBe(PAGE + 1);
    expect(db.meter.queries).toBe(1);
  });

  it('reaches the far end of the archive without reading past it', async () => {
    // Firestore bills documents an OFFSET skips. Paging to the end of 2000
    // missions with offsets would cost the sum of every page before it.
    const db = makeFirestore(rows);
    const repo = new FirestoreMissionRepository(db as never);

    let cursor = undefined;
    do {
      const page = await repo.findRecent(PAGE, cursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const pages = Math.ceil(SCALE / PAGE);
    // Linear in what was displayed, never quadratic in where you are.
    expect(db.meter.docsRead).toBeLessThanOrEqual(pages * (PAGE + 1));
  });
});


describe('finding a mission that is not on the first page', () => {
  /**
   * The bug this pins, which is the one the story is named after.
   *
   * Search filtered only the missions already loaded, and "Show more" was
   * hidden while a query was active. So a mission outside the first 24 could
   * not be found at all, and the learner was told "No missions match" - a
   * confident denial that their own work existed. It got worse every week,
   * because every new submission pushed one more mission out of reach.
   *
   * Verified against the real feed before the fix: searching for the oldest of
   * 117 live missions returned nothing.
   */
  const rows = buildMissions(SCALE);

  /** What the page's "Search older missions" walk does, in miniature. */
  async function walkUntilFound(target: string) {
    const db = makeFirestore(rows);
    const repo = new FirestoreMissionRepository(db as never);

    let pool = (await repo.findRecent(PAGE)).missions;
    let cursor = (await repo.findRecent(PAGE)).nextCursor ?? undefined;
    let pages = 0;

    while (cursor && pages < ARCHIVE_SEARCH_PAGES) {
      const page = await repo.findRecent(PAGE, cursor);
      pages += 1;
      const seen = new Set(pool.map((m) => m.id));
      pool = [...pool, ...page.missions.filter((m) => !seen.has(m.id))];
      cursor = page.nextCursor ?? undefined;
      if (pool.some((m) => m.id === target)) break;
    }

    return { found: pool.some((m) => m.id === target), pages, loaded: pool.length };
  }

  it('does not find it in the first page alone, which is why the walk exists', async () => {
    const db = makeFirestore(rows);
    const repo = new FirestoreMissionRepository(db as never);

    const first = await repo.findRecent(PAGE);

    // m00400 is deep in the archive: present, but nowhere near the front.
    expect(first.missions.some((m) => m.id === 'm00400')).toBe(false);
    expect(rows.some((r) => r.id === 'm00400')).toBe(true);
  });

  it('reaches a mission hundreds deep within the cap', async () => {
    const result = await walkUntilFound('m01700');

    expect(result.found).toBe(true);
    expect(result.pages).toBeLessThanOrEqual(ARCHIVE_SEARCH_PAGES);
  });

  it('stops at the cap rather than walking the whole archive', async () => {
    // The oldest mission of 2000 is beyond a single capped walk, and that is
    // the accepted limit of a linear search with no index. The point is that it
    // STOPS, rather than paging forever or billing an unbounded number of
    // reads, and the interface says how far it looked.
    const result = await walkUntilFound('m00000');

    expect(result.found).toBe(false);
    expect(result.pages).toBe(ARCHIVE_SEARCH_PAGES);
    expect(result.loaded).toBeLessThanOrEqual(PAGE * (ARCHIVE_SEARCH_PAGES + 1));
  });
});
