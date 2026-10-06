/**
 * A yard's layout is configuration, set per yard and editable on the settings
 * page (AB#468), not a constant in the code.
 *
 * The server half: the API's rules, the stored document, and the public
 * answer every simulator reads, with the measured yard as the fallback at each
 * step rather than a gap. yardLayoutEditor.test.tsx has the browser half.
 */

const directory = jest.fn();
jest.mock('@/infrastructure/config/yardDirectory', () => ({ yardDirectory: () => directory() }));

import { GET } from '@/app/api/yards/[yardId]/layout/route';
import { FirestoreYardRepository } from '@/infrastructure/persistence/FirestoreYardRepository';
import { checkYardLayout } from '@/infrastructure/validation/yardLayout';
import { YARD, type Yard as YardLayout } from '@/lib/rover-physics';
import type { Yard } from '@/core/domain/entities/Yard';

const DURBAN_LAYOUT: YardLayout = {
  widthCm: 300,
  depthCm: 200,
  start: { x: 150, y: 100, facingDegrees: 0 },
  rocks: [{ name: 'D1', x: 40, y: 40, widthCm: 10, depthCm: 10 }],
  zones: [],
};

const CURIOSITY: Yard = { id: 'curiosity', formerIds: ['uct-rover-1'], name: 'Cape Town Science Centre', area: 'Observatory', city: 'Cape Town', active: true };
const DURBAN: Yard = { id: 'durban', name: 'Durban Science Centre', area: 'Umbilo', city: 'Durban', active: true, layout: DURBAN_LAYOUT };

describe('the rules a layout is checked against', () => {
  it('accepts the measured yard', () => {
    expect(checkYardLayout(YARD)).toEqual({ layout: YARD });
  });

  it('says in words what is wrong, and where', () => {
    const outside = checkYardLayout({ ...YARD, rocks: [{ name: 'R9', x: 500, y: 10, widthCm: 5, depthCm: 5 }] });
    expect(outside).toEqual({ error: 'Rock R9 is past the east wall.', path: ['rocks', 0, 'x'] });
    const twice = checkYardLayout({ ...YARD, rocks: [YARD.rocks[0], YARD.rocks[0]] });
    expect(twice).toMatchObject({ error: 'Two rocks are called R1.' });
    expect(checkYardLayout({ ...YARD, widthCm: Number.NaN })).toMatchObject({ path: ['widthCm'] });
  });
});

describe('the stored layout', () => {
  const repositoryWith = (data: Record<string, unknown>) =>
    new FirestoreYardRepository({
      collection: () => ({ get: async () => ({ docs: [{ id: 'durban', data: () => data }] }) }),
    } as never);

  it('is read back when it checks out', async () => {
    const [yard] = await repositoryWith({ name: 'Durban', layout: DURBAN_LAYOUT }).findAll();
    expect(yard.layout).toEqual(DURBAN_LAYOUT);
  });

  it('is ignored, not served, when a hand edit broke it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const [yard] = await repositoryWith({ name: 'Durban', layout: { ...DURBAN_LAYOUT, widthCm: 'wide' } }).findAll();
    expect(yard.layout).toBeUndefined();
    warn.mockRestore();
  });
});

describe('the public answer', () => {
  const ask = async (yardId: string) => (await GET(new Request('https://x'), { params: Promise.resolve({ yardId }) })).json();

  beforeEach(() => directory.mockResolvedValue([CURIOSITY, DURBAN]));

  it("gives a configured yard's own layout", async () => {
    expect(await ask('durban')).toEqual({ yardId: 'durban', configured: true, layout: DURBAN_LAYOUT });
  });

  it('answers a former id with the yard it became', async () => {
    expect(await ask('uct-rover-1')).toMatchObject({ yardId: 'curiosity' });
  });

  it('gives the measured yard to a yard with no layout yet, and to one nobody knows', async () => {
    expect(await ask('curiosity')).toEqual({ yardId: 'curiosity', configured: false, layout: YARD });
    expect(await ask('atlantis')).toMatchObject({ layout: YARD });
  });
});
