import type { Yard } from '@/core/domain/entities/Yard';

/**
 * The yards this platform knows about.
 *
 * There is no delete. A yard is referenced by every mission ever run there, so
 * removing one orphans that history and a learner's page silently loses its
 * location. Retiring sets `active: false`: out of the sign-in list, still
 * resolving for everything already recorded.
 */
export interface IYardRepository {
  /** Every yard, retired ones included, because the read path needs them. */
  findAll(): Promise<Yard[]>;

  /** Create or update. The id is the rover's network name and is never edited. */
  save(yard: Yard): Promise<void>;

  /** Retire or restore. The only kind of removal there is. */
  setActive(yardId: string, active: boolean): Promise<void>;

  /**
   * Move a yard to a new id, recording the old one so it still resolves.
   *
   * Named for the operation rather than exposed as delete-and-create, because
   * those are not the same thing: this yard is not going away, it is answering
   * to a new name, and every mission carrying the old one must go on finding
   * it. A general delete would let a caller do the first half and orphan them.
   */
  rename(fromId: string, toId: string): Promise<void>;
}
