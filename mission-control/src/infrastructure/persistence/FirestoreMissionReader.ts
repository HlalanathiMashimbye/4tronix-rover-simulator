/**
 * Reading missions from Firestore, whichever SDK is doing the fetching.
 *
 * The repository used to be one class holding both SDKs and asking
 * `isAdminFirestore()` in every method, so each read was written twice inside
 * an if, and the browser's half had no test at all because every test faked
 * the Admin shape. Now the rules of reading (deleted reads as absent, pages by
 * cursor, one extra document to learn whether there is a next page) are
 * written once here, and each SDK supplies only the four fetches below.
 * Supporting another SDK means another subclass, not another branch.
 */

import type { Mission } from '@/core/domain/entities/Mission';
import type { MissionRun } from '@/core/domain/entities/MissionRun';
import type {
  IMissionReader,
  MissionCursor,
  MissionPage,
} from '@/core/domain/repositories/IMissionRepository';
import {
  isLive,
  missionFromDocument,
  runFromDocument,
  type DocumentLike,
  type MissionDocData,
} from './missionDocuments';

export abstract class FirestoreMissionReader implements IMissionReader {
  /** The mission document's data, or null when there is no such document. */
  protected abstract readMission(id: string): Promise<MissionDocData | null>;
  /** Missions whose id is in [start, end), at most `max`. */
  protected abstract readIdRange(start: string, end: string, max: number): Promise<DocumentLike[]>;
  /** Newest first by submittedAt then id, after `cursor` when given. */
  protected abstract readRecent(max: number, cursor?: MissionCursor): Promise<DocumentLike[]>;
  protected abstract readRuns(missionId: string): Promise<DocumentLike[]>;

  async findById(id: string): Promise<Mission | null> {
    const data = await this.readMission(id);
    // A deleted mission reads as absent, so a shared link 404s rather than
    // showing work an operator removed.
    return data && isLive(data) ? missionFromDocument(id, data) : null;
  }

  async findByIdPrefix(prefix: string, max: number): Promise<Mission[]> {
    // A range on the document ID uses the index every collection has, so this
    // needs no composite index. '' sorts after every ID character.
    return this.liveMissions(await this.readIdRange(prefix, prefix + '', max));
  }

  /**
   * Recent missions for the public feed. Reads `limit + 1` documents and
   * nothing else: the extra one says whether another page exists without a
   * separate count query, and queue positions, which the feed never shows,
   * are not paid for.
   */
  async findRecent(limit: number, cursor?: MissionCursor): Promise<MissionPage> {
    const docs = await this.readRecent(limit + 1, cursor);
    const hasMore = docs.length > limit;
    // Deletions are rare, so a page occasionally showing fewer cards is a
    // better trade than the composite index and backfill a query filter needs.
    const missions = this.liveMissions(hasMore ? docs.slice(0, limit) : docs);
    const last = missions[missions.length - 1];

    return {
      missions,
      // By cursor, not offset: an offset still reads and bills every skipped
      // document. Both ordering fields, so a shared submittedAt cannot make a
      // page skip or repeat a mission.
      nextCursor: hasMore && last ? { submittedAt: last.submittedAt, id: last.id } : null,
    };
  }

  /**
   * Every yard's attempt at a mission. [] for a mission nobody has run, which
   * callers must treat as ordinary: most of the archive predates runs.
   */
  async findRuns(missionId: string): Promise<MissionRun[]> {
    return (await this.readRuns(missionId))
      .filter((d) => isLive(d.data()))
      .map((d) => runFromDocument(d.id, d.data() as Partial<MissionRun>));
  }

  private liveMissions(docs: DocumentLike[]): Mission[] {
    return docs.filter((d) => isLive(d.data())).map((d) => missionFromDocument(d.id, d.data()));
  }
}
