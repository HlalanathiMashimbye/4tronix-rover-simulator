/**
 * Adding, editing and retiring yards.
 */

const requireAdmin = jest.fn();
const findAll = jest.fn();
const save = jest.fn();
const setActive = jest.fn();

class UnauthorizedError extends Error {}
class ForbiddenError extends Error {}

jest.mock('@/infrastructure/auth/dal', () => ({
  requireAdmin: () => requireAdmin(),
  UnauthorizedError,
  ForbiddenError,
}));

jest.mock('@/infrastructure/container.server', () => ({
  adminYardRepository: () => ({ findAll, save, setActive }),
}));

jest.mock('@/infrastructure/config/yardDirectory', () => ({ clearYardCache: jest.fn() }));

import { NextRequest } from 'next/server';

import { POST, PATCH } from '@/app/api/operator/yards/route';

const CURIOSITY = {
  id: 'curiosity',
  name: 'Cape Town Science Centre',
  area: 'Observatory',
  city: 'Cape Town',
  formerIds: ['uct-rover-1'],
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  addedBy: 'seed',
};

function req(method: 'POST' | 'PATCH', body: unknown) {
  return new NextRequest('https://example.com/api/operator/yards', {
    method,
    body: JSON.stringify(body),
  });
}

describe('/api/operator/yards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAdmin.mockResolvedValue({ uid: 'u1', email: 'admin@uct.ac.za', role: 'admin' });
    findAll.mockResolvedValue([CURIOSITY]);
  });

  describe('adding', () => {
    it('refuses an operator who is not an admin', async () => {
      requireAdmin.mockRejectedValue(new ForbiddenError());

      expect((await POST(req('POST', { id: 'x', name: 'a', area: 'b', city: 'c' }))).status).toBe(403);
      expect(save).not.toHaveBeenCalled();
    });

    it('refuses an id that would not work as a hostname', async () => {
      const resp = await POST(req('POST', { id: 'Cape Town!', name: 'a', area: 'b', city: 'c' }));

      expect(resp.status).toBe(400);
      expect((await resp.json()).error).toMatch(/hostname/i);
    });

    it('refuses an id already in use', async () => {
      const resp = await POST(req('POST', { id: 'curiosity', name: 'a', area: 'b', city: 'c' }));

      expect(resp.status).toBe(409);
      expect(save).not.toHaveBeenCalled();
    });

    it('refuses an id another yard used to have', async () => {
      /**
       * Missions submitted under the old name still resolve to that yard, so
       * reusing it would make one id mean two places depending on when the
       * mission ran.
       */
      const resp = await POST(req('POST', { id: 'uct-rover-1', name: 'a', area: 'b', city: 'c' }));

      expect(resp.status).toBe(409);
      expect((await resp.json()).error).toMatch(/used to be/i);
    });

    it('adds a yard as active, stamped with who added it', async () => {
      const resp = await POST(req('POST', { id: 'durban', name: 'Durban Science Centre', area: 'Umbilo', city: 'Durban' }));

      expect(resp.status).toBe(200);
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        id: 'durban', active: true, addedBy: 'admin@uct.ac.za',
      }));
    });
  });

  describe('editing', () => {
    it('corrects a venue name without touching anything else', async () => {
      await PATCH(req('PATCH', { id: 'curiosity', name: 'Cape Town Science Centre Trust' }));

      // Merged onto the existing yard: an edit to one field must not blank the
      // others or drop formerIds, createdAt and addedBy.
      expect(save).toHaveBeenCalledWith({
        ...CURIOSITY,
        name: 'Cape Town Science Centre Trust',
      });
    });

    it('refuses to blank the city, which is the part a learner reads', async () => {
      const resp = await PATCH(req('PATCH', { id: 'curiosity', city: '   ' }));

      expect(resp.status).toBe(400);
      expect(save).not.toHaveBeenCalled();
    });

    it('cannot change the id, because every mission carries it', async () => {
      /**
       * A new id is simply not a field the schema accepts, so it is ignored
       * rather than applied. Renaming a rover is a migration that has to write
       * formerIds, not a text edit.
       */
      await PATCH(req('PATCH', { id: 'curiosity', newId: 'something-else', name: 'Renamed' }));

      expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'curiosity' }));
    });

    it('404s for a yard that does not exist', async () => {
      expect((await PATCH(req('PATCH', { id: 'atlantis', name: 'x' }))).status).toBe(404);
    });
  });

  describe('retiring', () => {
    it('retires without deleting', async () => {
      const resp = await PATCH(req('PATCH', { id: 'curiosity', active: false }));

      expect(resp.status).toBe(200);
      expect(setActive).toHaveBeenCalledWith('curiosity', false);
    });

    it('brings one back', async () => {
      await PATCH(req('PATCH', { id: 'curiosity', active: true }));

      expect(setActive).toHaveBeenCalledWith('curiosity', true);
    });
  });
});
