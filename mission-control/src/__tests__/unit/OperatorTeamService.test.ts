/**
 * The decisions behind the team page, with no Firebase anywhere.
 *
 * The HTTP behaviour is covered end to end in operator.team.api.test.ts; this
 * is the use case on its own, against an in-memory directory.
 */

import { OperatorTeamService, TeamChangeFailed } from '@/core/application/services/OperatorTeamService';
import type { OperatorAccount, OperatorInvite, OperatorRole } from '@/core/domain/entities/OperatorAccount';
import type { IOperatorDirectory, OperatorIdentity } from '@/core/domain/repositories/IOperatorDirectory';

const ADMIN = { uid: 'admin', label: 'admin@rover.org' };

function directory(people: Array<{ uid: string; email: string; role?: OperatorRole }>) {
  const roles = new Map(people.map((p) => [p.uid, p.role ?? null]));
  const invites = new Map<string, OperatorInvite>();
  const signedOut: string[] = [];
  const dir: IOperatorDirectory = {
    listAccounts: async () =>
      people.filter((p) => roles.get(p.uid)).map((p): OperatorAccount => ({ uid: p.uid, email: p.email, role: roles.get(p.uid)! })),
    listInvites: async () => [...invites.values()],
    findByEmail: async (email) => {
      const p = people.find((x) => x.email === email);
      return p ? { uid: p.uid, email: p.email, claims: {} } : null;
    },
    grant: async (identity: OperatorIdentity, role) => void roles.set(identity.uid, role),
    revoke: async (identity: OperatorIdentity) => {
      roles.set(identity.uid, null);
      signedOut.push(identity.uid);
    },
    saveInvite: async (email, role, invitedBy) => void invites.set(email, { email, role, invitedAt: null, invitedBy }),
    deleteInvite: async (email) => invites.delete(email),
  };
  return { dir, roles, invites, signedOut };
}

const team = (dir: IOperatorDirectory, announce = jest.fn(async () => true)) => ({
  service: new OperatorTeamService(dir, announce),
  announce,
});

it('grants a role to an existing account and emails them', async () => {
  const { dir, roles } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }, { uid: 'thandi', email: 'thandi@rover.org' }]);
  const { service, announce } = team(dir);

  const result = await service.changeAccess(ADMIN, 'thandi@rover.org', 'operator');

  expect(result.outcome).toBe('changed');
  expect(roles.get('thandi')).toBe('operator');
  expect(announce).toHaveBeenCalledWith('thandi@rover.org', 'operator');
});

it('refuses to remove the last admin, and changes nothing', async () => {
  const { dir, roles, signedOut } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }, { uid: 'other', email: 'o@rover.org', role: 'operator' }]);

  const result = await team(dir).service.changeAccess({ uid: 'other', label: 'o' }, 'admin@rover.org', null);

  expect(result.outcome).toBe('blocked');
  expect(roles.get('admin')).toBe('admin');
  expect(signedOut).toEqual([]);
});

it('signs someone out when their access is removed, without emailing them', async () => {
  const { dir, signedOut } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }, { uid: 'thandi', email: 'thandi@rover.org', role: 'operator' }]);
  const { service, announce } = team(dir);

  expect((await service.changeAccess(ADMIN, 'thandi@rover.org', null)).outcome).toBe('changed');
  expect(signedOut).toEqual(['thandi']);
  expect(announce).not.toHaveBeenCalled();
});

it('writes nothing when the person already has the role', async () => {
  const { dir } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }, { uid: 'thandi', email: 'thandi@rover.org', role: 'operator' }]);
  const grant = jest.spyOn(dir, 'grant');
  const { service, announce } = team(dir);

  expect((await service.changeAccess(ADMIN, 'thandi@rover.org', 'operator')).outcome).toBe('unchanged');
  expect(grant).not.toHaveBeenCalled();
  expect(announce).not.toHaveBeenCalled();
});

it('holds access for an address that has never signed in, and removes it again', async () => {
  const { dir, invites } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }]);
  const { service } = team(dir);

  expect((await service.changeAccess(ADMIN, 'new@rover.org', 'operator')).outcome).toBe('invited');
  expect(invites.get('new@rover.org')).toMatchObject({ role: 'operator', invitedBy: 'admin@rover.org' });

  expect((await service.changeAccess(ADMIN, 'new@rover.org', null)).outcome).toBe('invite-removed');
  expect((await service.changeAccess(ADMIN, 'new@rover.org', null)).outcome).toBe('nothing-to-revoke');
});

it("still grants when the email cannot be sent, and says it was not emailed", async () => {
  const { dir, roles } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }, { uid: 'thandi', email: 'thandi@rover.org' }]);
  const { service } = team(dir, jest.fn(async () => false));

  const result = await service.changeAccess(ADMIN, 'thandi@rover.org', 'operator');

  expect(roles.get('thandi')).toBe('operator');
  expect(result.message).not.toMatch(/emailed/i);
});

it('reports a failed write with the message the admin sees', async () => {
  const { dir } = directory([{ uid: 'admin', email: 'admin@rover.org', role: 'admin' }, { uid: 'thandi', email: 'thandi@rover.org' }]);
  dir.grant = async () => {
    throw new Error('quota');
  };

  const change = team(dir).service.changeAccess(ADMIN, 'thandi@rover.org', 'operator');

  await expect(change).rejects.toBeInstanceOf(TeamChangeFailed);
  await expect(change).rejects.toThrow('Could not apply that change');
});
