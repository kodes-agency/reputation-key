// Identity context — remove member use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect } from 'vitest'
import { removeMember } from './remove-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { userId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  // Seed members so getMember() and listMembers() return data for last-admin guard
  identity.seedMembers([
    {
      id: 'member-1',
      userId: 'user-target',
      email: 'target@test.com',
      name: 'Target Member',
      role: 'Staff',
      rawRole: 'member',
      image: null,
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'admin-1',
      userId: 'user-00000000-0000-0000-0000-000000000001',
      email: 'admin@test.com',
      name: 'Admin',
      role: 'AccountAdmin',
      rawRole: 'owner',
      image: null,
      createdAt: new Date('2026-01-01'),
    },
  ])
  const useCase = removeMember({ identity, events, clock: () => FIXED_TIME })
  return { useCase, identity, events }
}

describe('removeMember', () => {
  it('allows AccountAdmin to remove a member', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'member-1' }, ctx)

    expect(result.success).toBe(true)
    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('identity.member.removed')
  })

  it('rejects PropertyManager from removing members', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('rejects Staff from removing members', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ memberId: 'member-1' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('emits member.removed event with correct data', async () => {
    const { useCase, events } = setup()
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
    const identity = createInMemoryIdentityPort()
    const events = createCapturingEventBus()
    const useCase = removeMember({ identity, events, clock: () => FIXED_TIME })
    // Only one admin in the org — the last-admin guard must fire.
    identity.seedMembers([
      {
        id: 'solo-admin',
        userId: 'user-solo-admin',
        email: 'solo@test.com',
        name: 'Solo Admin',
        role: 'AccountAdmin',
        rawRole: 'owner',
        image: null,
        createdAt: new Date('2026-01-01'),
      },
    ])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ memberId: 'solo-admin' }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )

    // The admin was not removed.
    const still = await identity.getMember(ctx, 'solo-admin')
    expect(still?.role).toBe('AccountAdmin')
  })

  it('allows removing an AccountAdmin when a second admin remains', async () => {
    const identity = createInMemoryIdentityPort()
    const events = createCapturingEventBus()
    const useCase = removeMember({ identity, events, clock: () => FIXED_TIME })
    identity.seedMembers([
      {
        id: 'admin-a',
        userId: 'user-admin-a',
        email: 'a@test.com',
        name: 'Admin A',
        role: 'AccountAdmin',
        rawRole: 'owner',
        image: null,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'admin-b',
        userId: 'user-admin-b',
        email: 'b@test.com',
        name: 'Admin B',
        role: 'AccountAdmin',
        rawRole: 'owner',
        image: null,
        createdAt: new Date('2026-01-01'),
      },
    ])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase({ memberId: 'admin-a' }, ctx)

    expect(result.success).toBe(true)
    expect(events.capturedByTag('identity.member.removed')).toHaveLength(1)
  })
})
