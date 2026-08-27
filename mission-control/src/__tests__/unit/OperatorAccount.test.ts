import {
  changeBlocker,
  isNoOpChange,
  sortAccounts,
  isOperatorRole,
  type OperatorAccount,
} from '@/core/domain/entities/OperatorAccount';

const admin: OperatorAccount = { uid: 'a1', email: 'admin@rover.com', role: 'admin' };
const admin2: OperatorAccount = { uid: 'a2', email: 'second@rover.com', role: 'admin' };
const operator: OperatorAccount = { uid: 'o1', email: 'op@rover.com', role: 'operator' };

describe('the lockout rule', () => {
  it('refuses to remove the only admin', () => {
    // The whole point of the page is that nobody needs a service-account key.
    // Revoking the last admin puts the key back on the critical path.
    const blocked = changeBlocker({
      actorUid: 'a2',
      targetUid: 'a1',
      nextRole: null,
      accounts: [admin, operator],
    });
    expect(blocked).toMatch(/only admin account/i);
  });

  it('refuses to demote the only admin to operator', () => {
    // Demotion locks everyone out exactly as revocation does. Guarding one and
    // not the other would leave the door open with a different label on it.
    const blocked = changeBlocker({
      actorUid: 'a2',
      targetUid: 'a1',
      nextRole: 'operator',
      accounts: [admin, operator],
    });
    expect(blocked).toMatch(/only admin account/i);
  });

  it('allows removing an admin while another remains', () => {
    expect(
      changeBlocker({
        actorUid: 'a2',
        targetUid: 'a1',
        nextRole: null,
        accounts: [admin, admin2, operator],
      }),
    ).toBeNull();
  });

  it('never blocks removing a plain operator', () => {
    expect(
      changeBlocker({
        actorUid: 'a1',
        targetUid: 'o1',
        nextRole: null,
        accounts: [admin, operator],
      }),
    ).toBeNull();
  });
});

describe('acting on yourself', () => {
  it('refuses self-revocation', () => {
    const blocked = changeBlocker({
      actorUid: 'a1',
      targetUid: 'a1',
      nextRole: null,
      accounts: [admin, admin2],
    });
    expect(blocked).toMatch(/your own admin access/i);
  });

  it('refuses self-demotion even with another admin present', () => {
    // Recoverable, but an admin removing their own access mid-event is a
    // failure with a person standing next to a robot. Another admin can do it.
    const blocked = changeBlocker({
      actorUid: 'a1',
      targetUid: 'a1',
      nextRole: 'operator',
      accounts: [admin, admin2],
    });
    expect(blocked).toMatch(/your own admin access/i);
  });

  it('lets an admin re-grant themselves admin, which changes nothing', () => {
    expect(
      changeBlocker({
        actorUid: 'a1',
        targetUid: 'a1',
        nextRole: 'admin',
        accounts: [admin, admin2],
      }),
    ).toBeNull();
  });
});

describe('promotion', () => {
  it('allows promoting an operator to admin', () => {
    // The recommended fix for a single-admin deployment, so it must not be
    // caught by any guard.
    expect(
      changeBlocker({
        actorUid: 'a1',
        targetUid: 'o1',
        nextRole: 'admin',
        accounts: [admin, operator],
      }),
    ).toBeNull();
  });

  it('allows granting access to an account that has none', () => {
    expect(
      changeBlocker({
        actorUid: 'a1',
        targetUid: 'newcomer',
        nextRole: 'operator',
        accounts: [admin],
      }),
    ).toBeNull();
  });
});

describe('no-op detection', () => {
  it('spots a grant that changes nothing', () => {
    // A pointless write still rotates refresh tokens and signs the person out.
    expect(
      isNoOpChange({ actorUid: 'a1', targetUid: 'o1', nextRole: 'operator', accounts: [operator] }),
    ).toBe(true);
  });

  it('does not flag a real change', () => {
    expect(
      isNoOpChange({ actorUid: 'a1', targetUid: 'o1', nextRole: 'admin', accounts: [operator] }),
    ).toBe(false);
  });

  it('treats revoking someone with no access as a no-op', () => {
    expect(
      isNoOpChange({ actorUid: 'a1', targetUid: 'ghost', nextRole: null, accounts: [operator] }),
    ).toBe(true);
  });
});

describe('presentation', () => {
  it('lists admins first, then alphabetically', () => {
    const sorted = sortAccounts([operator, admin2, admin]);
    expect(sorted.map((a) => a.email)).toEqual([
      'admin@rover.com',
      'second@rover.com',
      'op@rover.com',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [operator, admin];
    sortAccounts(input);
    expect(input[0]).toBe(operator);
  });

  it('recognises only the two real roles', () => {
    expect(isOperatorRole('admin')).toBe(true);
    expect(isOperatorRole('operator')).toBe(true);
    expect(isOperatorRole('superuser')).toBe(false);
    expect(isOperatorRole(undefined)).toBe(false);
  });
});
