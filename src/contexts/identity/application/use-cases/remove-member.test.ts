// Identity context — remove member use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: the member delete + removed fact go through the sequential
// command-store fake. Members are seeded in BOTH surfaces: the identity port
// backs the read-side UX guards, the command store backs the atomic write.

import { describe, it, expect } from 'vitest'
import { removeMember } from './remove-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import type { SequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
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
  const events = createCapturingEventBus()
  const commandStore = createSequentialIdentityCommandStore({ events })
  for (const m of seeded) seedMemberBoth(identity, commandStore, m)
  const useCase = removeMember({ identity, commandStore, clock: () => FIXED_TIME })
  return { useCase, identity, events, commandStore }
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
    const { useCase, events, commandStore } = setup([STAFF_MEMBER, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'member-1' }, ctx)

    expect(result.success).toBe(true)
    expect(commandStore.memberById('member-1')).toBeNull()
    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('identity.member.removed')
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

  it('emits member.removed event with correct data', async () => {
    const { useCase, events } = setup([STAFF_MEMBER, ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: 'member-1' }, ctx)

    const emitted = events.capturedByTag('identity.member.removed')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
    expect(emitted[0].removedBy).toBe(ctx.userId)
    // Fix #1: the event must carry the removed user's id (targetMember.userId),
    // NOT the better-auth member-row id (memberId === 'member-1').
    expect(emitted[0].userId).toBe(userId('user-target'))
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
    const { useCase, events, commandStore } = setup([adminA, adminB])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'admin-a' }, ctx)

    expect(result.success).toBe(true)
    expect(commandStore.memberById('admin-a')).toBeNull()
    expect(commandStore.memberById('admin-b')).not.toBeNull()
    expect(events.capturedByTag('identity.member.removed')).toHaveLength(1)
  })
})
