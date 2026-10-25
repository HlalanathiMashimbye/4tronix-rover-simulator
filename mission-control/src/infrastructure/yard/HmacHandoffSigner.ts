import { createHash, createHmac } from 'node:crypto';

import type { IHandoffSigner, MissionHandoff } from '@/core/domain/services/IHandoffSigner';

/**
 * HMAC-SHA256 over the handoff, keyed with the secret the satellite already
 * holds for uploading recordings. The first line names the purpose, so a
 * signature made here can never pass as anything else signed with that secret.
 *
 * yard/satellite/mission_handoff.py checks it. Both sides are tested against
 * yard/satellite/tests/mission_handoff_vector.json, so neither can change the
 * format alone.
 */
export function handoffMessage(handoff: MissionHandoff): string {
  const codeHash = createHash('sha256').update(handoff.code, 'utf8').digest('hex');
  return ['mission-handoff/v1', handoff.yardId, handoff.missionId, String(handoff.expires), codeHash].join('\n');
}

export class HmacHandoffSigner implements IHandoffSigner {
  constructor(private readonly secret: () => string | undefined) {}

  sign(handoff: MissionHandoff): string | null {
    const secret = this.secret()?.trim();
    if (!secret) return null;
    return createHmac('sha256', secret).update(handoffMessage(handoff), 'utf8').digest('hex');
  }
}
