import 'server-only';

import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';

import type { Yard } from '@/core/domain/entities/Yard';
import type { IYardRepository } from '@/core/domain/repositories/IYardRepository';

const YARDS_COLLECTION = 'yards';

/**
 * Yards in Firestore, written only through the Admin SDK.
 *
 * World-readable by rule, like missions: a yard is a venue name already
 * printed on a public mission page, and the learner's player needs to resolve
 * one without an account. Writes are admin-only and go through here.
 */
export class FirestoreYardRepository implements IYardRepository {
  constructor(private readonly db: AdminFirestore) {}

  async findAll(): Promise<Yard[]> {
    const snapshot = await this.db.collection(YARDS_COLLECTION).get();
    return snapshot.docs.map((doc) => this.toYard(doc.id, doc.data()));
  }

  async save(yard: Yard): Promise<void> {
    const { id, ...fields } = yard;
    await this.db
      .collection(YARDS_COLLECTION)
      .doc(id)
      // Merged, so restoring a retired yard or correcting a venue name does
      // not drop createdAt and addedBy.
      .set(this.withoutUndefined(fields), { merge: true });
  }

  async setActive(yardId: string, active: boolean): Promise<void> {
    await this.db.collection(YARDS_COLLECTION).doc(yardId).update({ active });
  }

  /**
   * An explicit allowlist, not a spread of the document.
   *
   * The mission repository learned this the hard way: a field absent from its
   * mapper is silently dropped, and every unit test still passes because they
   * assert on what the mapper returns. Listing them means a new field is
   * added here deliberately.
   */
  private toYard(id: string, data: Record<string, unknown>): Yard {
    return {
      id,
      name: typeof data.name === 'string' ? data.name : id,
      area: typeof data.area === 'string' ? data.area : '',
      city: typeof data.city === 'string' ? data.city : '',
      formerIds: Array.isArray(data.formerIds) ? (data.formerIds as string[]) : undefined,
      // Defaults to active. A yard written before this field existed is one
      // somebody is using, so the safe reading is "in use", not "retired".
      active: data.active !== false,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
      addedBy: typeof data.addedBy === 'string' ? data.addedBy : undefined,
    };
  }

  private withoutUndefined(fields: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  }
}
