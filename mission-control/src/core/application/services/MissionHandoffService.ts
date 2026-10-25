import type { IMissionReader } from '@/core/domain/repositories/IMissionRepository';
import type { IHandoffSigner } from '@/core/domain/services/IHandoffSigner';

/**
 * Long enough for the run station to open and check it, short enough that a
 * copied link is useless soon after. The satellite also uses each signature
 * once.
 */
const LIFETIME_SECONDS = 300;

export type HandoffResult =
  | { ok: true; yardId: string; missionId: string; code: string; expires: number; signature: string | null }
  | { ok: false; failure: 'not-found' | 'forbidden'; error: string };

/**
 * What Send to Rover hands the yard: the mission's stored code, signed for
 * the operator's yard. The code comes from the record, never from the
 * request, so a signature only ever vouches for what the learner submitted.
 */
export class MissionHandoffService {
  constructor(
    private readonly missions: IMissionReader,
    private readonly signer: IHandoffSigner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handoff(missionId: string, operatorYardId: string | null): Promise<HandoffResult> {
    const mission = await this.missions.findById(missionId);
    if (!mission || mission.deleted) {
      return { ok: false, failure: 'not-found', error: 'Mission not found' };
    }
    if (!operatorYardId || mission.yardId !== operatorYardId) {
      return { ok: false, failure: 'forbidden', error: 'That mission is at another yard.' };
    }

    const expires = Math.floor(this.now().getTime() / 1000) + LIFETIME_SECONDS;
    const handoff = { yardId: operatorYardId, missionId: mission.id, code: mission.code, expires };
    return { ok: true, ...handoff, signature: this.signer.sign(handoff) };
  }
}
