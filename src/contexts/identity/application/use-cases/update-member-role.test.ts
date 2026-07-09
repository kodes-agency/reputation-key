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
  rawRole: 'member',
  image: null,
  createdAt: new Date('2025-01-01'),
}

const PM_MEMBER: MemberRecord = {
  id: 'member-pm',
  userId: 'user-pm',
  email: 'pm@test.com',
  name: 'PM User',
  role: 'PropertyManager',
  rawRole: 'admin',
  image: null,
  createdAt: new Date('2025-01-01'),
}

const ADMIN_MEMBER: MemberRecord = {
  id: 'member-admin',
  userId: 'user-admin',
  email: 'admin@test.com',
  name: 'Admin User',
  role: 'AccountAdmin',
  rawRole: 'owner',
  image: null,
  createdAt: new Date('2025-01-01'),
}

const ADMIN_MEMBER_2: MemberRecord = {
  id: 'member-admin-2',
  userId: 'user-admin-2',
  email: 'admin2@test.com',
  name: 'Admin User 2',
  role: 'AccountAdmin',
  rawRole: 'owner',
  image: null,
  createdAt: new Date('2025-01-01'),
}

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = updateMemberRole({
    identity,
    events,
    clock: () => FIXED_TIME,
  })
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
    const emitted = events.capturedByTag('identity.member.role_changed')
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

    const [event] = events.capturedByTag('identity.member.role_changed')
    expect(event.previousRole).toBe('Staff')
    expect(event.newRole).toBe('PropertyManager')
    expect(event.userId).toBe(ctx.userId)
    expect(event.organizationId).toBe(ctx.organizationId)
  })

  it('forbids demoting the last AccountAdmin of the organization', async () => {
    const { useCase, identity } = setup()
    // Only one admin in the org — the last-admin guard must fire.
    identity.seedMembers([ADMIN_MEMBER])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ memberId: 'member-admin', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')

    // The admin was not demoted.
    const still = await identity.getMember(ctx, 'member-admin')
    expect(still?.role).toBe('AccountAdmin')
  })

  it('rejects demoting an AccountAdmin even with a second admin (role hierarchy guards first)', async () => {
    const { useCase, identity, events } = setup()
    identity.seedMembers([ADMIN_MEMBER, ADMIN_MEMBER_2])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // The role-hierarchy rule (domain/rules.ts) forbids changing an
    // equal-or-higher role, so an AccountAdmin cannot demote another
    // AccountAdmin. The last-admin guard is defense-in-depth for a path the
    // hierarchy already blocks; its reject branch is exercised by the
    // "forbids demoting the last AccountAdmin" test above.
    await expect(
      useCase({ memberId: 'member-admin', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')

    const still = await identity.getMember(ctx, 'member-admin')
    expect(still?.role).toBe('AccountAdmin')
    expect(events.capturedByTag('identity.member.role_changed')).toHaveLength(0)
  })

  it('counts a multi-role owner via rawRole for the last-owner guard (H2/M4)', async () => {
    const { useCase, identity } = setup()
    // A multi-role owner: built-in Role is null, but rawRole 'owner,editor' grants owner.
    // Previously this member crashed listMembers (toDomainRoleStrict) AND escaped the
    // last-owner guard (role !== ADMIN_ROLE). Now it must be counted as an owner.
    identity.seedMembers([
      {
        id: 'multi-owner',
        userId: 'user-multi',
        email: 'multi@test.com',
        name: 'Multi Owner',
        role: null,
        rawRole: 'owner,editor',
        image: null,
        createdAt: new Date('2025-01-01'),
      },
    ])
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // Demoting the sole multi-role owner must be blocked — the guard fires via
    // isOwnerToken(rawRole) even though the built-in role is null.
    await expect(
      useCase({ memberId: 'multi-owner', role: 'Staff' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })
})
