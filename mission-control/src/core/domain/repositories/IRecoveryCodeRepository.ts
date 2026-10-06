/**
 * Stores and looks up recovery-code hashes.
 *
 * The collection is keyed by the SHA-256 hex of the code, so lookup is a
 * single document get — no query, no index, no scan.
 */

export interface IRecoveryCodeRepository {
  storeCodeHash(learnerId: string, learnerRef: string, codeHash: string): Promise<void>;
  lookupByHash(codeHash: string): Promise<string | null>;
  retireByLearnerRef(learnerRef: string): Promise<void>;
}
