/**
 * Where a learner's address is actually read from.
 *
 * Split out of MissionNotificationService.test.ts together with the code.
 * These are the Firestore-shaped questions - which document, which field wins
 * - and the service's own tests no longer need a Firestore stub to ask whether
 * an email gets sent.
 */

import { FirestoreLearnerContactReader } from '@/infrastructure/persistence/FirestoreLearnerContactReader';

/**
 * `contactDoc` models learners/{id}/private/contact - the browser-unreadable
 * subcollection the address actually lives in. `learnerDoc.learnerEmail` models
 * the legacy field left on records written before it moved there.
 */
function makeFirestoreStub(
  learnerDoc: Record<string, unknown> | undefined,
  contactDoc?: Record<string, unknown> | Error,
) {
  const where = jest.fn(() => ({
    limit: jest.fn(() => ({
      get: jest.fn(async () => ({
        empty: !learnerDoc,
        docs: learnerDoc ? [{ ref: docRef, data: () => learnerDoc }] : [],
      })),
    })),
  }));

  const docRef = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => {
          if (contactDoc instanceof Error) throw contactDoc;
          return { exists: !!contactDoc, data: () => contactDoc };
        }),
      })),
    })),
  };

  return { firestore: { collection: jest.fn(() => ({ where })) }, where };
}

function readerOver(stub: ReturnType<typeof makeFirestoreStub>) {
  return new FirestoreLearnerContactReader(stub.firestore as never);
}

describe('FirestoreLearnerContactReader', () => {
  it('finds the learner by learnerRef, not by document id', async () => {
    // Missions carry only a hash of the learner id, so there is no id to fetch by.
    const stub = makeFirestoreStub({ displayName: 'Ada' });

    await readerOver(stub).findByLearnerRef('learner-1');

    expect(stub.where).toHaveBeenCalledWith('learnerRef', '==', 'learner-1');
  });

  it('finds nothing when there is no learner record', async () => {
    await expect(readerOver(makeFirestoreStub(undefined)).findByLearnerRef('learner-1'))
      .resolves.toEqual({});
  });

  it('reads the address from the private contact record, not the learner document', async () => {
    // The learner document is readable by anyone holding the learner id, and
    // those ids are published on world-readable missions - so the address is
    // kept in a subcollection browsers are denied. This is the primary path.
    const stub = makeFirestoreStub({ displayName: 'Ada' }, { learnerEmail: 'ada@school.edu' });

    await expect(readerOver(stub).findByLearnerRef('learner-1'))
      .resolves.toEqual({ email: 'ada@school.edu', displayName: 'Ada' });
  });

  it('prefers the private contact record over a legacy address', async () => {
    // A learner who has re-saved their address has it in both places while the
    // old field is being cleaned up. The current one must win.
    const stub = makeFirestoreStub(
      { learnerEmail: 'stale@school.edu', displayName: 'Ada' },
      { learnerEmail: 'current@school.edu' },
    );

    expect((await readerOver(stub).findByLearnerRef('learner-1')).email).toBe('current@school.edu');
  });

  it('still finds a legacy address for learners who have not re-saved one', async () => {
    const stub = makeFirestoreStub({ learnerEmail: 'ada@school.edu', displayName: 'Ada' });

    expect((await readerOver(stub).findByLearnerRef('learner-1')).email).toBe('ada@school.edu');
  });

  it('falls back to the legacy address when the contact record cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const stub = makeFirestoreStub(
      { learnerEmail: 'ada@school.edu' },
      new Error('permission denied'),
    );

    expect((await readerOver(stub).findByLearnerRef('learner-1')).email).toBe('ada@school.edu');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lets a failed lookup throw, so it is not mistaken for "no learner"', async () => {
    const firestore = {
      collection: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn(async () => {
              throw new Error('Firestore unavailable');
            }),
          })),
        })),
      })),
    };

    await expect(new FirestoreLearnerContactReader(firestore as never).findByLearnerRef('learner-1'))
      .rejects.toThrow('Firestore unavailable');
  });
});
