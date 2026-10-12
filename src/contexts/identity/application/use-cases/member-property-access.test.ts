// Identity context — member Property access use cases.
// The store fake keeps active grants in memory and builds the fact only when
// something changed, as the PostgreSQL store does.

import { describe, expect, it, vi } from 'vitest'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { userId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import { isIdentityError } from '../../domain/errors'
import type { IdentityMemberPropertyAccessChanged } from '../../domain/events'
import type { MemberRecord } from '../ports/identity.port'
import type {
  AppliedPropertyAccess,
  MemberPropertyAccessStore,
  SetPropertyAccessCommand,
} from '../ports/member-property-access.port'
import {
  listMemberPropertyAccess,
  setMemberPropertyAccess,
} from './member-property-access'

const NOW = new Date('2026-09-30T12:00:00Z')
const PROPERTY_A = '00000000-0000-4000-8000-00000000000a'
const PROPERTY_B = '00000000-0000-4000-8000-00000000000b'
const PROPERTY_C = '00000000-0000-4000-8000-00000000000c'
const ADMIN_CTX = buildTestAuthContext({
  role: 'AccountAdmin',
  userId: userId('user-admin'),
})

const member = (overrides: Partial<MemberRecord>): MemberRecord => ({
  id: 'member-pm',
  userId: 'user-pm',
  email: 'pm@test.com',
  name: 'PM',
  role: 'PropertyManager',
  rawRole: 'admin',
  image: null,
  createdAt: new Date('2026-01-01'),
  ...overrides,
})

const PM = member({})
const OTHER_ADMIN = member({
  id: 'member-admin-2',
  userId: 'user-admin-2',
  role: 'AccountAdmin',
  rawRole: 'owner',
})
const SELF = member({
  id: 'member-admin',
  userId: 'user-admin',
  role: 'AccountAdmin',
  rawRole: 'owner',
})
const LEGACY_MEMBER = member({
  id: 'member-legacy',
  userId: 'user-legacy',
  role: 'Member',
  rawRole: 'member',
})
/** A multi-role token maps to no built-in Role. */
const CUSTOM_ROLE_MEMBER = member({
  id: 'member-custom',
  userId: 'user-custom',
  role: null,
  rawRole: 'admin,editor',
})

function createStoreFake(initial: Readonly<Record<string, ReadonlyArray<string>>> = {}) {
  const grants = new Map(
    Object.entries(initial).map(([uid, ids]) => [uid, new Set(ids)] as const),
  )
  const commands: SetPropertyAccessCommand[] = []
  const facts: IdentityMemberPropertyAccessChanged[] = []
  const listedAt: Date[] = []
  const store: MemberPropertyAccessStore = {
    async listActiveByOrganization(_organizationId, at) {
      listedAt.push(at)
      return [...grants].map(([uid, ids]) => ({ userId: uid, propertyIds: [...ids] }))
    },
    async setPropertyAccess(command) {
      commands.push(command)
      const held = grants.get(command.userId) ?? new Set<string>()
      const applied: AppliedPropertyAccess = {
        grantedPropertyIds: command.grantPropertyIds.filter((id) => !held.has(id)),
        revokedPropertyIds: command.revokePropertyIds.filter((id) => held.has(id)),
      }
      applied.grantedPropertyIds.forEach((id) => held.add(id))
      applied.revokedPropertyIds.forEach((id) => held.delete(id))
      grants.set(command.userId, held)
      if (applied.grantedPropertyIds.length + applied.revokedPropertyIds.length > 0) {
        facts.push(command.buildEvent(applied))
      }
      return applied
    },
  }
  return { store, commands, facts, listedAt }
}

function setup(initial: Readonly<Record<string, ReadonlyArray<string>>> = {}) {
  const identity = createInMemoryIdentityPort()
  identity.seedMembers([PM, OTHER_ADMIN, SELF, LEGACY_MEMBER, CUSTOM_ROLE_MEMBER])
  const fake = createStoreFake(initial)
  const reconcile = vi.fn(async () => undefined)
  const set = setMemberPropertyAccess({
    identity,
    store: fake.store,
    clock: () => NOW,
    reconcileResponsibleManagerEligibility: reconcile,
  })
  const list = listMemberPropertyAccess({ store: fake.store, clock: () => NOW })
  return { ...fake, set, list, reconcile }
}

const refusedWith = (code: string, message?: string) => (error: unknown) =>
  isIdentityError(error) &&
  error.code === code &&
  (message === undefined || error.message === message)

describe('setMemberPropertyAccess', () => {
  it("grants and revokes a PropertyManager's Properties and records who did it", async () => {
    const { set, commands, facts, reconcile } = setup({ 'user-pm': [PROPERTY_B] })

    const applied = await set(
      {
        memberId: 'member-pm',
        grantPropertyIds: [PROPERTY_A],
        revokePropertyIds: [PROPERTY_B],
      },
      ADMIN_CTX,
    )

    expect(applied).toEqual({
      grantedPropertyIds: [PROPERTY_A],
      revokedPropertyIds: [PROPERTY_B],
    })
    expect(commands).toEqual([
      expect.objectContaining({
        organizationId: ADMIN_CTX.organizationId,
        userId: 'user-pm',
        actorUserId: 'user-admin',
        grantPropertyIds: [PROPERTY_A],
        revokePropertyIds: [PROPERTY_B],
        now: NOW,
      }),
    ])
    expect(facts).toEqual([
      expect.objectContaining({
        _tag: 'identity.member.property_access_changed',
        organizationId: ADMIN_CTX.organizationId,
        memberUserId: 'user-pm',
        userId: 'user-admin',
        grantedPropertyIds: [PROPERTY_A],
        revokedPropertyIds: [PROPERTY_B],
        occurredAt: NOW,
      }),
    ])
    // A revoke may leave Responsible Manager duties the member can no longer hold.
    expect(reconcile).toHaveBeenCalledWith(
      ADMIN_CTX.organizationId,
      'user-pm',
      'user-admin',
    )
  })

  it('does not reconcile responsibilities when the request revokes nothing', async () => {
    const { set, reconcile } = setup()

    await set(
      { memberId: 'member-pm', grantPropertyIds: [PROPERTY_A], revokePropertyIds: [] },
      ADMIN_CTX,
    )

    expect(reconcile).not.toHaveBeenCalled()
  })

  it('sends each Property once, however often the request names it', async () => {
    const { set, commands } = setup({ 'user-pm': [PROPERTY_C] })

    await set(
      {
        memberId: 'member-pm',
        grantPropertyIds: [PROPERTY_A, PROPERTY_A],
        revokePropertyIds: [PROPERTY_C, PROPERTY_C],
      },
      ADMIN_CTX,
    )

    expect(commands[0]?.grantPropertyIds).toEqual([PROPERTY_A])
    expect(commands[0]?.revokePropertyIds).toEqual([PROPERTY_C])
  })

  it('writes no fact for a repeat that changes nothing', async () => {
    const { set, facts } = setup({ 'user-pm': [PROPERTY_A] })

    const applied = await set(
      {
        memberId: 'member-pm',
        grantPropertyIds: [PROPERTY_A],
        revokePropertyIds: [PROPERTY_B],
      },
      ADMIN_CTX,
    )

    expect(applied).toEqual({ grantedPropertyIds: [], revokedPropertyIds: [] })
    expect(facts).toEqual([])
  })

  it('reconciles again when a revoke is repeated after its reconcile failed', async () => {
    const { set, facts, reconcile } = setup({ 'user-pm': [PROPERTY_B] })
    reconcile.mockRejectedValueOnce(new Error('temporary reconciliation failure'))
    const request = {
      memberId: 'member-pm',
      grantPropertyIds: [],
      revokePropertyIds: [PROPERTY_B],
    }

    // The revoke and its fact commit before the reconcile fails.
    await expect(set(request, ADMIN_CTX)).rejects.toThrow(
      'temporary reconciliation failure',
    )
    // The repeat revokes nothing more, yet still releases what the member lost.
    await expect(set(request, ADMIN_CTX)).resolves.toEqual({
      grantedPropertyIds: [],
      revokedPropertyIds: [],
    })

    expect(facts).toHaveLength(1)
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(reconcile).toHaveBeenLastCalledWith(
      ADMIN_CTX.organizationId,
      'user-pm',
      'user-admin',
    )
  })

  it('refuses a PropertyManager caller', async () => {
    const { set, commands } = setup()

    await expect(
      set(
        { memberId: 'member-pm', grantPropertyIds: [PROPERTY_A], revokePropertyIds: [] },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toSatisfy(refusedWith('forbidden'))
    expect(commands).toEqual([])
  })

  it('refuses a caller whose member.update scope is narrower than the Organization', async () => {
    const { set, commands } = setup()
    const permissions: ReadonlyArray<Permission> = ['member.update']
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      userId: userId('user-admin'),
      effectivePermissions: new Set(permissions),
      scopeByPermission: new Map([['member.update', 'assigned-properties']]),
    })

    await expect(
      set(
        { memberId: 'member-pm', grantPropertyIds: [PROPERTY_A], revokePropertyIds: [] },
        ctx,
      ),
    ).rejects.toSatisfy(refusedWith('forbidden'))
    expect(commands).toEqual([])
  })

  it('refuses a member who is not in the Organization', async () => {
    const { set } = setup()

    await expect(
      set(
        {
          memberId: 'member-gone',
          grantPropertyIds: [PROPERTY_A],
          revokePropertyIds: [],
        },
        ADMIN_CTX,
      ),
    ).rejects.toSatisfy(refusedWith('member_not_found'))
  })

  it("refuses changing the caller's own access", async () => {
    const { set, commands } = setup()

    await expect(
      set(
        {
          memberId: 'member-admin',
          grantPropertyIds: [PROPERTY_A],
          revokePropertyIds: [],
        },
        ADMIN_CTX,
      ),
    ).rejects.toSatisfy(
      refusedWith('forbidden', 'You cannot change your own property access'),
    )
    expect(commands).toEqual([])
  })

  it('refuses an AccountAdmin target, who can access every Property', async () => {
    const { set, commands } = setup()

    await expect(
      set(
        {
          memberId: 'member-admin-2',
          grantPropertyIds: [PROPERTY_A],
          revokePropertyIds: [],
        },
        ADMIN_CTX,
      ),
    ).rejects.toSatisfy(
      refusedWith('validation_error', 'Account Admins can access every property'),
    )
    expect(commands).toEqual([])
  })
})
it.each([
  ['a legacy Member', 'member-legacy'],
  ['a member holding a custom role', 'member-custom'],
])('refuses %s without calling them an Account Admin', async (_label, memberId) => {
  const { set, commands } = setup()

  await expect(
    set({ memberId, grantPropertyIds: [PROPERTY_A], revokePropertyIds: [] }, ADMIN_CTX),
  ).rejects.toSatisfy(
    refusedWith(
      'validation_error',
      'Property access can be edited only for a Property Manager',
    ),
  )
  expect(commands).toEqual([])
})

describe('listMemberPropertyAccess', () => {
  it("returns every member's active grants as of now", async () => {
    const { list, listedAt } = setup({ 'user-pm': [PROPERTY_A, PROPERTY_B] })

    await expect(list(undefined, ADMIN_CTX)).resolves.toEqual({
      access: [{ userId: 'user-pm', propertyIds: [PROPERTY_A, PROPERTY_B] }],
    })
    expect(listedAt).toEqual([NOW])
  })

  it("refuses a PropertyManager, who must not read other members' grants", async () => {
    const { list, listedAt } = setup({ 'user-pm': [PROPERTY_A] })

    await expect(
      list(undefined, buildTestAuthContext({ role: 'PropertyManager' })),
    ).rejects.toSatisfy(refusedWith('forbidden'))
    expect(listedAt).toEqual([])
  })
})
