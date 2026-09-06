// Identity context — remove member use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: the member delete + removed fact go through the sequential
// command-store fake. Members are seeded in BOTH surfaces: the identity port
// backs the read-side UX guards, the command store backs the atomic write.

import { describe, it, expect, vi } from 'vitest'
import { removeMember } from './remove-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import type { SequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { userId } from '#/shared/domain/ids'
import type { MemberRecord } from '../ports/identity.port'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const DEFAULT_ORG_ID = 'org-00000000-0000-0000-0000-000000000001'

/** Seed the same member into the identity port (reads) and the store (write).
 * The store row persists the raw better-auth role string. */
const seedMemberBoth = (
  identity: ReturnType<typeof createInMemoryIdentityPort>,
  commandStore: SequentialIdentityCommandStore,
  member: MemberRecord,
) => {
  identity.seedMembers([member])
  commandStore.seedMember({
    id: member.id,
    organizationId: DEFAULT_ORG_ID,
    userId: member.userId,
    email: member.email,
    role: member.rawRole,
    createdAt: member.createdAt,
  })
}

const setup = (seeded: ReadonlyArray<MemberRecord> = []) => {
  const identity = createInMemoryIdentityPort()
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
  for (const m of seeded) seedMemberBoth(identity, commandStore, m)
  const useCase = removeMember({ identity, commandStore, clock: () => FIXED_TIME })
  return { useCase, identity, outbox, commandStore }
}

const STAFF_MEMBER: MemberRecord = {
  id: 'member-1',
  userId: 'user-target',
  email: 'target@test.com',
  name: 'Target Member',
  role: 'Staff',
  rawRole: 'member',
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
  it('allows AccountAdmin to remove a member', async () => {
    const { useCase, outbox, commandStore } = setup([STAFF_MEMBER, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'member-1' }, ctx)

    expect(result.success).toBe(true)
    expect(commandStore.memberById('member-1')).toBeNull()
    expect(outbox.facts).toHaveLength(1)
    expect(outbox.facts[0]._tag).toBe('identity.member.removed')
  })

  it('rejects PropertyManager from removing members', async () => {
    const { useCase } = setup([STAFF_MEMBER, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('rejects Staff from removing members', async () => {
    const { useCase } = setup([STAFF_MEMBER, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('records the member.removed fact with correct data', async () => {
    const { useCase, outbox } = setup([STAFF_MEMBER, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: 'member-1' }, ctx)

    const facts = outbox.byTag('identity.member.removed')
    expect(facts).toHaveLength(1)
    expect(facts[0].organizationId).toBe(ctx.organizationId)
    expect(facts[0].removedBy).toBe(ctx.userId)
    // The fact must carry the removed user's id (targetMember.userId), not the
    // better-auth member-row id (memberId === 'member-1').
    expect(facts[0].userId).toBe(userId('user-target'))
  })

  it('fences the removed user import scope before deleting membership', async () => {
    const identity = createInMemoryIdentityPort()
    const outbox = createRecordedOutbox()
    const commandStore = createSequentialIdentityCommandStore({ outbox })
    for (const member of [STAFF_MEMBER, ADMIN_MEMBER]) {
      seedMemberBoth(identity, commandStore, member)
    }
    const prepareGoogleConnectorDeparture = vi.fn(async () => undefined)
    const cancelGoogleImportsForUser = vi.fn(async () => undefined)
    const useCase = removeMember({
      identity,
      commandStore,
      clock: () => FIXED_TIME,
      prepareGoogleConnectorDeparture,
      cancelGoogleImportsForUser,
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: STAFF_MEMBER.id }, ctx)

    expect(prepareGoogleConnectorDeparture).toHaveBeenCalledWith(
      ctx.organizationId,
      STAFF_MEMBER.userId,
      'member_removed',
    )
    expect(cancelGoogleImportsForUser).toHaveBeenCalledWith(
      ctx.organizationId,
      STAFF_MEMBER.userId,
    )
    expect(commandStore.memberById(STAFF_MEMBER.id)).toBeNull()
  })

  it('releases the target member authorities before deleting membership', async () => {
    const identity = createInMemoryIdentityPort()
    const outbox = createRecordedOutbox()
    const commandStore = createSequentialIdentityCommandStore({ outbox })
    for (const member of [STAFF_MEMBER, ADMIN_MEMBER]) {
      seedMemberBoth(identity, commandStore, member)
    }
    const releaseMemberAuthorities = vi.fn(async () => undefined)
    const useCase = removeMember({
      identity,
      commandStore,
      clock: () => FIXED_TIME,
      releaseMemberAuthorities,
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: STAFF_MEMBER.id }, ctx)

    expect(releaseMemberAuthorities).toHaveBeenCalledWith(
      ctx.organizationId,
      STAFF_MEMBER.userId,
      ctx.userId,
    )
    expect(commandStore.memberById(STAFF_MEMBER.id)).toBeNull()
  })

  /**
   * LIF-01-T21. The cross-context fences must be complete BEFORE the Identity
   * transaction opens, because only that ordering leaves a repairable state
   * behind a crash. This pins the order rather than merely the calls.
   */
  it('completes every cross-context fence before the membership transaction', async () => {
    const identity = createInMemoryIdentityPort()
    const outbox = createRecordedOutbox()
    const commandStore = createSequentialIdentityCommandStore({ outbox })
    for (const member of [STAFF_MEMBER, ADMIN_MEMBER]) {
      seedMemberBoth(identity, commandStore, member)
    }
    const order: string[] = []
    const useCase = removeMember({
      identity,
      commandStore: {
        ...commandStore,
        removeMember: async (command) => {
          order.push('identity-transaction')
          return commandStore.removeMember(command)
        },
      },
      clock: () => FIXED_TIME,
      prepareGoogleConnectorDeparture: async () => {
        order.push('google-connector')
      },
      cancelGoogleImportsForUser: async () => {
        order.push('google-imports')
      },
      releaseMemberAuthorities: async () => {
        order.push('release-authorities')
      },
    })

    await useCase(
      { memberId: STAFF_MEMBER.id },
      buildTestAuthContext({ role: 'AccountAdmin' }),
    )

    expect(order).toEqual([
      'google-connector',
      'google-imports',
      'release-authorities',
      'identity-transaction',
    ])
  })

  it('preserves membership when import fencing fails', async () => {
    const identity = createInMemoryIdentityPort()
    const outbox = createRecordedOutbox()
    const commandStore = createSequentialIdentityCommandStore({ outbox })
    for (const member of [STAFF_MEMBER, ADMIN_MEMBER]) {
      seedMemberBoth(identity, commandStore, member)
    }
    const useCase = removeMember({
      identity,
      commandStore,
      clock: () => FIXED_TIME,
      cancelGoogleImportsForUser: async () => {
        throw new Error('import lifecycle unavailable')
      },
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ memberId: STAFF_MEMBER.id }, ctx)).rejects.toThrow(
      'import lifecycle unavailable',
    )

    expect(commandStore.memberById(STAFF_MEMBER.id)).not.toBeNull()
    expect(outbox.byTag('identity.member.removed')).toEqual([])
  })

  it('preserves membership when connector departure fencing fails', async () => {
    const identity = createInMemoryIdentityPort()
    const outbox = createRecordedOutbox()
    const commandStore = createSequentialIdentityCommandStore({ outbox })
    for (const member of [STAFF_MEMBER, ADMIN_MEMBER]) {
      seedMemberBoth(identity, commandStore, member)
    }
    const cancelGoogleImportsForUser = vi.fn(async () => undefined)
    const useCase = removeMember({
      identity,
      commandStore,
      clock: () => FIXED_TIME,
      prepareGoogleConnectorDeparture: async () => {
        throw new Error('connector lifecycle unavailable')
      },
      cancelGoogleImportsForUser,
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ memberId: STAFF_MEMBER.id }, ctx)).rejects.toThrow(
      'connector lifecycle unavailable',
    )

    expect(cancelGoogleImportsForUser).not.toHaveBeenCalled()
    expect(commandStore.memberById(STAFF_MEMBER.id)).not.toBeNull()
    expect(outbox.byTag('identity.member.removed')).toEqual([])
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
    const { useCase, identity, commandStore } = setup([soloAdmin])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ memberId: 'solo-admin' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )

    // The admin was not removed (neither read-side nor write-side).
    const still = await identity.getMember(ctx, 'solo-admin')
    expect(still?.role).toBe('AccountAdmin')
    expect(commandStore.memberById('solo-admin')).not.toBeNull()
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
    const { useCase, outbox, commandStore } = setup([adminA, adminB])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'admin-a' }, ctx)

    expect(result.success).toBe(true)
    expect(commandStore.memberById('admin-a')).toBeNull()
    expect(commandStore.memberById('admin-b')).not.toBeNull()
    expect(outbox.byTag('identity.member.removed')).toHaveLength(1)
  })
})
