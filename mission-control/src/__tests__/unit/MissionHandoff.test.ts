/**
 * Send to Rover's signed handoff, Mission Control's half.
 *
 * The satellite checks the signature in mission_handoff.py. Both halves are
 * tested against yard/satellite/tests/mission_handoff_vector.json, so neither
 * can change the format alone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MissionHandoffService } from '@/core/application/services/MissionHandoffService';
import type { MissionRecord } from '@/core/domain/entities/Mission';
import type { IMissionReader } from '@/core/domain/repositories/IMissionRepository';
import { HmacHandoffSigner } from '@/infrastructure/yard/HmacHandoffSigner';

const VECTOR = JSON.parse(
  readFileSync(join(__dirname, '../../../../yard/satellite/tests/mission_handoff_vector.json'), 'utf8'),
);

describe('the signature', () => {
  it('is the one the satellite checks against', () => {
    const signer = new HmacHandoffSigner(() => VECTOR.secret);

    expect(signer.sign({
      yardId: VECTOR.yardId, missionId: VECTOR.missionId, code: VECTOR.code, expires: VECTOR.expires,
    })).toBe(VECTOR.signature);
  });

  it('is null with no shared secret, so the run station waits for Send', () => {
    expect(new HmacHandoffSigner(() => undefined).sign({ yardId: 'y', missionId: 'm', code: '', expires: 1 })).toBeNull();
    expect(new HmacHandoffSigner(() => '  ').sign({ yardId: 'y', missionId: 'm', code: '', expires: 1 })).toBeNull();
  });
});

describe('the handoff', () => {
  const stored = {
    id: 'm1', yardId: 'curiosity', code: 'rover.forward(60)', status: 'queued',
    learnerRef: 'r', sessionId: 's', submittedAt: '2026-10-25T10:00:00Z',
  } as MissionRecord;

  function service(found: MissionRecord | null) {
    const missions = { findById: jest.fn().mockResolvedValue(found) } as unknown as IMissionReader;
    const signer = { sign: jest.fn().mockReturnValue('sig') };
    const now = () => new Date('2026-10-26T08:00:00Z');
    return { svc: new MissionHandoffService(missions, signer, now), signer };
  }

  it("signs the mission's stored code for the operator's yard, for five minutes", async () => {
    const { svc, signer } = service(stored);

    const result = await svc.handoff('m1', 'curiosity');

    const expires = Date.parse('2026-10-26T08:05:00Z') / 1000;
    expect(result).toEqual({ ok: true, yardId: 'curiosity', missionId: 'm1', code: 'rover.forward(60)', expires, signature: 'sig' });
    expect(signer.sign).toHaveBeenCalledWith({ yardId: 'curiosity', missionId: 'm1', code: 'rover.forward(60)', expires });
  });

  it('refuses a mission at another yard, or an operator with no yard', async () => {
    expect(await service(stored).svc.handoff('m1', 'elsewhere')).toMatchObject({ ok: false, failure: 'forbidden' });
    expect(await service(stored).svc.handoff('m1', null)).toMatchObject({ ok: false, failure: 'forbidden' });
  });

  it('refuses a mission that is missing or deleted', async () => {
    expect(await service(null).svc.handoff('m1', 'curiosity')).toMatchObject({ ok: false, failure: 'not-found' });
    expect(await service({ ...stored, deleted: true }).svc.handoff('m1', 'curiosity')).toMatchObject({ ok: false, failure: 'not-found' });
  });
});
