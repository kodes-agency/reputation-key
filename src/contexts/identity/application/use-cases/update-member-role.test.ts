// Identity context — update member role use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// This use case evolved from thin to full: it loads the target member and checks
// the actual role hierarchy.

import { describe, it, expect } from 'vitest'
import { updateMemberRole } from './update-member-role'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { MemberRecord } from '../ports/identity.port'

const STAFF_MEMBER: MemberRecord = {
  id: 'member-staff',
  userId: 'user-staff',
  email: 'staff@test.com',
  name: 'Staff User',
  role: 'Staff',
  image: null,
  createdAt: new Date('2025-01-01'),
}

const PM_MEMBER: MemberRecord = {
  id: 'member-pm',
  userId: 'user-pm',
  email: 'pm@test.com',
  name: 'PM User',
  role: 'PropertyManager',
  image: null,
  createdAt: new Date('2025-01-01'),
}

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = updateMemberRole({ identity, events })
  return { useCase, identity, events }
}

describe('updateMemberRole', () => {
  it('allows AccountAdmin to promote Staff to PropertyManager', async () => {
    const { useCase, identity, events } = setup()
    identity.seedMembers([STAFF_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(
      { memberId: 'member-staff', role: 'PropertyManager' },
      ctx,
    )

    expect(result.success).toBe(true)

    // Verify the port received the update
    const updated = await identity.getMember(ctx, 'member-staff')
    expect(updated?.role).toBe('PropertyManager')

    // Verify event
    const emitted = events.capturedByTag('member.role-changed')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].previousRole).toBe('Staff')
    expect(emitted[0].newRole).toBe('PropertyManager')
  })

  it('rejects PropertyManager from changing any member role', async () => {
    const { useCase, identity } = setup()
    identity.seedMembers([STAFF_MEMBER])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ memberId: 'member-staff', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects Staff from changing any role', async () => {
    const { useCase, identity } = setup()
    identity.seedMembers([STAFF_MEMBER])
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ memberId: 'member-staff', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager from changing another PropertyManager', async () => {
    const { useCase, identity } = setup()
    identity.seedMembers([PM_MEMBER])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ memberId: 'member-pm', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager from assigning AccountAdmin', async () => {
    const { useCase, identity } = setup()
    identity.seedMembers([STAFF_MEMBER])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ memberId: 'member-staff', role: 'AccountAdmin' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('throws member_not_found when target does not exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ memberId: 'nonexistent', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'member_not_found')
  })

  it('emits member.role-changed with previous and new role', async () => {
    const { useCase, identity, events } = setup()
    identity.seedMembers([STAFF_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: 'member-staff', role: 'PropertyManager' }, ctx)

    const [event] = events.capturedByTag('member.role-changed')
    expect(event.previousRole).toBe('Staff')
    expect(event.newRole).toBe('PropertyManager')
    expect(event.changedBy).toBe(ctx.userId)
    expect(event.organizationId).toBe(ctx.organizationId)
  })
})
