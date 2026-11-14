// Identity context — remove member use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// The member delete + removed fact commit through the atomic identity command
// store on real PostgreSQL. Members are seeded in BOTH surfaces: the identity
// port backs the read-side UX guards, the database backs the atomic write.

import { describe, it, expect, vi } from 'vitest'
import { removeMember } from './remove-member.server'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createAtomicIdentityCommandStore } from '../infrastructure/identity-command-store'
import { setupIdentityMembersDb } from '#/shared/testing/identity-members-fixtures'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../domain/errors'
import type { MemberRecord } from '../application/ports/identity.port'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const DEFAULT_ORG_ID = 'org-00000000-0000-0000-0000-000000000001'

const fixtures = setupIdentityMembersDb(createAtomicIdentityCommandStore)

/** Seed the same member into the identity port (reads) and the store (write).
 * The store row persists the raw better-auth role string. */
const seedMemberBoth = async (
  identity: ReturnType<typeof createInMemoryIdentityPort>,
  member: MemberRecord,
) => {
  identity.seedMembers([member])
  await fixtures.seedMember({
    id: member.id,
    organizationId: DEFAULT_ORG_ID,
    userId: member.userId,
    email: member.email,
    role: member.rawRole,
    createdAt: member.createdAt,
  })
}

const setup = async (seeded: ReadonlyArray<MemberRecord> = []) => {
  const identity = createInMemoryIdentityPort()
  const commandStore = fixtures.store()
  for (const m of seeded) await seedMemberBoth(identity, m)
  const useCase = removeMember({ identity, commandStore, clock: () => FIXED_TIME })
  return { useCase, identity, commandStore }
}

const MEMBER_RECORD: MemberRecord = {
  id: 'member-1',
  userId: 'user-target',
  email: 'target@test.com',
  name: 'Target Member',
  role: 'PropertyManager',
  rawRole: 'admin',
  image: null,
  createdAt: new Date('2026-01-01'),
}

const ADMIN_MEMBER: MemberRecord = {
  id: 'admin-1',
  userId: 'user-00000000-0000-0000-0000-000000000001',
  email: 'admin@test.com',
  name: 'Admin',
  role: 'AccountAdmin',
  rawRole: 'owner',
  image: null,
  createdAt: new Date('2026-01-01'),
}

describe('removeMember', () => {
  it('directs a staff-only login to Staff without removing access', async () => {
    const target = { ...MEMBER_RECORD, role: 'Member' as const, rawRole: 'member' }
    const h = await setup([target, ADMIN_MEMBER])
    await expect(
      h.useCase({ memberId: target.id }, buildTestAuthContext({ role: 'AccountAdmin' })),
    ).rejects.toThrow('Remove this person from Staff')
    expect(await fixtures.memberById(target.id)).not.toBeNull()
    expect(await fixtures.facts()).toEqual([])
  })
  it('keeps the manager membership when staff cleanup fails and completes on retry', async () => {
    const h = await setup([MEMBER_RECORD, ADMIN_MEMBER])
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error('Staff removal is unfinished'))
      .mockResolvedValue(undefined)
    const remove = removeMember({
      identity: h.identity,
      commandStore: h.commandStore,
      clock: () => FIXED_TIME,
      removeStaffForMemberDeparture: cleanup,
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await expect(remove({ memberId: MEMBER_RECORD.id }, ctx)).rejects.toThrow(
      'Staff removal is unfinished',
    )
    expect(await fixtures.memberById(MEMBER_RECORD.id)).not.toBeNull()
    expect(await remove({ memberId: MEMBER_RECORD.id }, ctx)).toEqual({ success: true })
    expect(cleanup).toHaveBeenCalledWith(MEMBER_RECORD.userId, ctx)
  })
  it('allows AccountAdmin to remove a member', async () => {
    const { useCase } = await setup([MEMBER_RECORD, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'member-1' }, ctx)

    expect(result.success).toBe(true)
    expect(await fixtures.memberById('member-1')).toBeNull()
    expect(await fixtures.facts()).toHaveLength(1)
    expect((await fixtures.facts())[0]?.tag).toBe('identity.member.removed')
  })

  it('rejects PropertyManager from removing members', async () => {
    const { useCase } = await setup([MEMBER_RECORD, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('rejects Member from removing members', async () => {
    const { useCase } = await setup([MEMBER_RECORD, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('records the member.removed fact with correct data', async () => {
    const { useCase } = await setup([MEMBER_RECORD, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: 'member-1' }, ctx)

    const facts = await fixtures.factsByTag('identity.member.removed')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.payload.organizationId).toBe(ctx.organizationId)
    expect(facts[0]?.payload.removedBy).toBe(ctx.userId)
    // The fact must carry the removed user's id (targetMember.userId), not the
    // better-auth member-row id (memberId === 'member-1').
    expect(facts[0]?.payload.userId).toBe('user-target')
  })

  it('refuses an actor demoted since the request was admitted, without writes', async () => {
    const h = await setup([MEMBER_RECORD, ADMIN_MEMBER])
    // A concurrent demotion committed after the request's own role was read.
    await fixtures.seedMember({
      id: ADMIN_MEMBER.id,
      organizationId: DEFAULT_ORG_ID,
      userId: ADMIN_MEMBER.userId,
      email: ADMIN_MEMBER.email,
      role: 'admin',
      createdAt: ADMIN_MEMBER.createdAt,
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(h.useCase({ memberId: MEMBER_RECORD.id }, ctx)).rejects.toMatchObject({
      code: 'forbidden',
    })

    expect(await fixtures.memberById(MEMBER_RECORD.id)).not.toBeNull()
    expect(await fixtures.facts()).toEqual([])
  })

  it('finishes staff removal, then commits the removal and nothing after it', async () => {
    const identity = createInMemoryIdentityPort()
    const commandStore = fixtures.store()
    for (const member of [MEMBER_RECORD, ADMIN_MEMBER]) {
      await seedMemberBoth(identity, member)
    }
    const order: string[] = []
    const useCase = removeMember({
      identity,
      commandStore: {
        ...commandStore,
        removeMember: async (command) => {
          order.push(`identity-transaction:${command.actorUserId}`)
          return commandStore.removeMember(command)
        },
      },
      clock: () => FIXED_TIME,
      removeStaffForMemberDeparture: async () => {
        order.push('staff-departure')
      },
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: MEMBER_RECORD.id }, ctx)

    // Responsibilities and Google authority are released by their owners from
    // the removal fact, never before the membership is gone.
    expect(order).toEqual(['staff-departure', `identity-transaction:${ctx.userId}`])
    expect(await fixtures.factsByTag('identity.member.removed')).toHaveLength(1)
  })

  it('forbids removing the last AccountAdmin of the organization', async () => {
    const soloAdmin: MemberRecord = {
      id: 'solo-admin',
      userId: 'user-solo-admin',
      email: 'solo@test.com',
      name: 'Solo Admin',
      role: 'AccountAdmin',
      rawRole: 'owner',
      image: null,
      createdAt: new Date('2026-01-01'),
    }
    const { useCase, identity } = await setup([soloAdmin])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ memberId: 'solo-admin' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )

    // The admin was not removed (neither read-side nor write-side).
    const still = await identity.getMember(ctx, 'solo-admin')
    expect(still?.role).toBe('AccountAdmin')
    expect(await fixtures.memberById('solo-admin')).not.toBeNull()
  })

  it('allows removing an AccountAdmin when a second admin remains', async () => {
    const adminA: MemberRecord = {
      id: 'admin-a',
      userId: 'user-admin-a',
      email: 'a@test.com',
      name: 'Admin A',
      role: 'AccountAdmin',
      rawRole: 'owner',
      image: null,
      createdAt: new Date('2026-01-01'),
    }
    const adminB: MemberRecord = {
      id: 'admin-b',
      userId: 'user-admin-b',
      email: 'b@test.com',
      name: 'Admin B',
      role: 'AccountAdmin',
      rawRole: 'owner',
      image: null,
      createdAt: new Date('2026-01-01'),
    }
    const { useCase } = await setup([adminA, adminB, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'admin-a' }, ctx)

    expect(result.success).toBe(true)
    expect(await fixtures.memberById('admin-a')).toBeNull()
    expect(await fixtures.memberById('admin-b')).not.toBeNull()
    expect(await fixtures.factsByTag('identity.member.removed')).toHaveLength(1)
  })

  // Leaving is its own command, which refuses until every responsibility is
  // handed over. Removal releases them with no successor, so a caller who
  // names their own membership would leave around that rule.
  it('refuses the caller as its own target, before staff removal starts', async () => {
    const identity = createInMemoryIdentityPort()
    const commandStore = fixtures.store()
    const otherAdmin: MemberRecord = {
      ...ADMIN_MEMBER,
      id: 'admin-2',
      userId: 'user-admin-2',
      email: 'admin-2@test.com',
    }
    for (const member of [ADMIN_MEMBER, otherAdmin]) {
      await seedMemberBoth(identity, member)
    }
    const removeStaffForMemberDeparture = vi.fn(async () => undefined)
    const useCase = removeMember({
      identity,
      commandStore,
      clock: () => FIXED_TIME,
      removeStaffForMemberDeparture,
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    expect(ADMIN_MEMBER.userId).toBe(ctx.userId)

    await expect(useCase({ memberId: ADMIN_MEMBER.id }, ctx)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'forbidden',
      message:
        'You cannot remove yourself; leaving the organization is a separate action',
    })

    expect(removeStaffForMemberDeparture).not.toHaveBeenCalled()
    expect(await fixtures.memberById(ADMIN_MEMBER.id)).not.toBeNull()
    expect(await fixtures.factsByTag('identity.member.removed')).toEqual([])
  })
})
