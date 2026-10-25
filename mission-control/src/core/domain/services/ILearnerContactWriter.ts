/**
 * Saving where a learner's mail goes. The reader's other half; see
 * ILearnerContactReader and learnerContact.ts for where the address lives.
 */
export interface ILearnerContactWriter {
  /**
   * Save the learner's address, or remove it with null. Also clears any
   * address an old client-side write left on the readable learner document.
   */
  save(learnerId: string, email: string | null): Promise<void>;
}
