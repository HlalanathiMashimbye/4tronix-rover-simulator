/**
 * Signs a mission handed from Mission Control to a yard's run station.
 *
 * The handoff travels in a link the operator's browser opens, and anything can
 * open a link. The run station sends a mission by itself only when the
 * satellite can check this signature with the secret it shares with Mission
 * Control, so a link from anywhere else waits for someone to press Send.
 */
export interface MissionHandoff {
  yardId: string;
  missionId: string;
  code: string;
  /** Unix seconds. The satellite refuses the signature after this. */
  expires: number;
}

export interface IHandoffSigner {
  /** The signature, or null when no shared secret is configured. */
  sign(handoff: MissionHandoff): string | null;
}
