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

  async rename(fromId: string, toId: string): Promise<void> {
    const collection = this.db.collection(YARDS_COLLECTION);
    const existing = await collection.doc(fromId).get();
    if (!existing.exists) return;

    const yard = this.toYard(fromId, existing.data() ?? {});
    const { id: _id, ...fields } = yard;

    // One batch, so there is never a moment with the yard under both ids or
    // under neither. The old id joins formerIds rather than disappearing:
    // every mission already submitted carries it, and findYardIn resolves
    // through that list.
    const batch = this.db.batch();
    batch.set(collection.doc(toId), this.withoutUndefined({
      ...fields,
      formerIds: [...(yard.formerIds ?? []), fromId],
    }));
    batch.delete(collection.doc(fromId));
    await batch.commit();
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
