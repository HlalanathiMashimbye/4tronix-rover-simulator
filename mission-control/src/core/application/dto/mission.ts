/**
 * What the application layer accepts when a mission is submitted or updated.
 *
 * These types used to be inferred from the Zod schemas in
 * infrastructure/validation, which meant MissionService - an application
 * service, the layer that is supposed to be independent of how requests
 * arrive - imported its own input type from infrastructure. The arrow pointed
 * the wrong way, and it pointed at a validation library: swap Zod for anything
 * else and the domain's vocabulary changes with it.
 *
 * Stated here instead, in plain TypeScript. The schemas now assert they
 * produce these shapes (`satisfies z.ZodType<CreateMissionDto>`), so the
 * validator answers to the contract rather than defining it, and a drift
 * between them is a compile error rather than a silent redefinition.
 */

/** A learner submitting a mission. */
export interface CreateMissionDto {
  /** Which yard's queue this joins. */
  yardId: string;
  /** Anonymous learner identity, stable across sessions on one device. */
  learnerId: string;
  /** The browser session that submitted it. */
  sessionId: string;
  /** Optional, and only stored hashed: lets a learner find their history. */
  learnerEmail?: string;
  /**
   * One of the generated names. Never free text: mission names land on a
   * world-readable document (AB#402).
   */
  name: string;
  /** The Python the rover will run. */
  code: string;
  /** Serialised Blockly workspace, when the mission was built from blocks. */
  blocklyState?: string;
  /** Set when this mission was submitted via the Create Mission handoff from a completed Progressive Challenges challenge. */
  origin?: 'challenge';
  /** Which challenge this mission's solution came from. Only set alongside origin: 'challenge'. */
  challengeId?: string;
}

/** An operator or the satellite recording what happened to a mission. */
export interface UpdateMissionDto {
  status?: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  executionResult?: {
    isSuccessful: boolean;
    consoleOutput: string;
    errorMessage?: string;
  };
  videoUrl?: string;
  youtubeUrl?: string;
  startedAt?: string;
  completedAt?: string;
}
