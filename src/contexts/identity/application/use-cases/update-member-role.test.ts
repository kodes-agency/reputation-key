// Identity context — update member role use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// This use case evolved from thin to full: it loads the target member and checks
// the actual role hierarchy.
// BQC-3.5: the role update + role_changed fact go through the sequential
// command-store fake. Members are seeded in BOTH surfaces: the identity port
// backs the read-side UX guards, the command store backs the atomic write.

import { describe, it, expect, vi } from 'vitest'
import { updateMemberRole, type UpdateMemberRoleDeps } from './update-member-role'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import type { SequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { MemberRecord } from '../ports/identity.port'
import { userId } from '#/shared/domain/ids'

const MEMBER_RECORD: MemberRecord = {
  id: 'member-standard',
  userId: 'user-member',
  email: 'member@test.com',
  name: 'Member User',
  role: 'Member',
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

/** An AccountAdmin caller who is neither of the seeded admins. */
const ADMIN_ACTOR = userId('user-admin-actor')

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const DEFAULT_ORG_ID = 'org-00000000-0000-0000-0000-000000000001'

/** Seed the same member into the identity port (reads) and the store (write). */
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

const setup = (
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>,
  prepareGoogleConnectorDeparture?: UpdateMemberRoleDeps['prepareGoogleConnectorDeparture'],
) => {
  const identity = createInMemoryIdentityPort()
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
  const useCase = updateMemberRole({
    identity,
    commandStore,
    clock: () => FIXED_TIME,
    reconcileResponsibleManagerEligibility,
    prepareGoogleConnectorDeparture,
  })
  return { useCase, identity, outbox, commandStore }
}

describe('updateMemberRole', () => {
  it('reconciles manager responsibilities after a role change', async () => {
    const calls: string[][] = []
    const { useCase, identity, commandStore } = setup(async (...input) => {
      calls.push(input)
    })
    seedMemberBoth(identity, commandStore, PM_MEMBER)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: PM_MEMBER.id, role: 'AccountAdmin' }, ctx)

    expect(calls).toEqual([[ctx.organizationId, PM_MEMBER.userId, ctx.userId]])
    expect(commandStore.memberById(PM_MEMBER.id)?.role).toBe('owner')
  })

  it('retries eligibility reconciliation after the role write already committed', async () => {
    let attempts = 0
    const { useCase, identity, commandStore } = setup(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary reconciliation failure')
    })
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ memberId: MEMBER_RECORD.id, role: 'PropertyManager' }, ctx),
    ).rejects.toThrow('temporary reconciliation failure')
    await expect(
      useCase({ memberId: MEMBER_RECORD.id, role: 'PropertyManager' }, ctx),
    ).resolves.toEqual({ success: true })
    expect(attempts).toBe(2)
  })

  it('allows AccountAdmin to promote Member to PropertyManager', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(
      { memberId: 'member-standard', role: 'PropertyManager' },
      ctx,
    )

    expect(result.success).toBe(true)

    // The member row carries the better-auth role string
    expect(commandStore.memberById('member-standard')?.role).toBe('admin')

    // Verify the durable fact.
    const facts = outbox.byTag('identity.member.role_changed')
    expect(facts).toHaveLength(1)
    expect(facts[0].previousRole).toBe('Member')
    expect(facts[0].newRole).toBe('PropertyManager')
  })

  it('rejects PropertyManager from changing any member role', async () => {
    const { useCase, identity, commandStore } = setup()
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ memberId: 'member-standard', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects Member from changing any role', async () => {
    const { useCase, identity, commandStore } = setup()
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(
      useCase({ memberId: 'member-standard', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager from changing another PropertyManager', async () => {
    const { useCase, identity, commandStore } = setup()
    seedMemberBoth(identity, commandStore, PM_MEMBER)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ memberId: 'member-pm', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager from assigning AccountAdmin', async () => {
    const { useCase, identity, commandStore } = setup()
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ memberId: 'member-standard', role: 'AccountAdmin' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('throws member_not_found when target does not exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ memberId: 'nonexistent', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'member_not_found')
  })

  it('records member.role-changed with previous and new role', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: 'member-standard', role: 'PropertyManager' }, ctx)

    const [event] = outbox.byTag('identity.member.role_changed')
    expect(event.previousRole).toBe('Member')
    expect(event.newRole).toBe('PropertyManager')
    expect(event.userId).toBe(ctx.userId)
    expect(event.organizationId).toBe(ctx.organizationId)
    expect(event.memberUserId).toBe('user-member')
  })

  it('forbids demoting the last AccountAdmin of the organization', async () => {
    const { useCase, identity, commandStore } = setup()
    // Only one admin in the org — the last-admin guard must fire.
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ memberId: 'member-admin', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')

    // The admin was not demoted (neither read-side nor write-side).
    const still = await identity.getMember(ctx, 'member-admin')
    expect(still?.role).toBe('AccountAdmin')
    expect(commandStore.memberById('member-admin')?.role).toBe('owner')
  })

  it('lets an AccountAdmin demote another AccountAdmin while a second one remains (D2)', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER_2)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin', userId: ADMIN_ACTOR })

    await expect(
      useCase({ memberId: 'member-admin', role: 'PropertyManager' }, ctx),
    ).resolves.toEqual({ success: true })

    expect(commandStore.memberById('member-admin')?.role).toBe('admin')
    const [fact] = outbox.byTag('identity.member.role_changed')
    expect(fact?.previousRole).toBe('AccountAdmin')
    expect(fact?.newRole).toBe('PropertyManager')
    expect(fact?.memberUserId).toBe('user-admin')
  })

  it('refuses a member changing their own role, before the last-owner guard', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER_2)
    // The caller is the target itself, and another AccountAdmin exists, so
    // only the self-change rule can refuse this.
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      userId: userId(ADMIN_MEMBER.userId),
    })

    await expect(
      useCase({ memberId: 'member-admin', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy(
      (e) =>
        isIdentityError(e) &&
        e.code === 'forbidden' &&
        e.message === 'Ask another Account Admin to change your role',
    )
    expect(commandStore.memberById('member-admin')?.role).toBe('owner')
    expect(outbox.byTag('identity.member.role_changed')).toHaveLength(0)
  })

  it('refuses a change to the role the member already holds', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER_2)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin', userId: ADMIN_ACTOR })

    await expect(
      useCase({ memberId: 'member-admin', role: 'AccountAdmin' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'validation_error')
    expect(outbox.byTag('identity.member.role_changed')).toHaveLength(0)
  })

  it('refuses a same-role change of the last AccountAdmin as validation, not last-owner', async () => {
    const { useCase, identity, commandStore } = setup()
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin', userId: ADMIN_ACTOR })

    await expect(
      useCase({ memberId: 'member-admin', role: 'AccountAdmin' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'validation_error')
  })

  it("fences the demoted AccountAdmin's Google connector only once the demotion has committed", async () => {
    const roleWhenFenced: Array<string | undefined> = []
    const fence = vi.fn(async () => {
      roleWhenFenced.push(commandStore.memberById(ADMIN_MEMBER.id)?.role)
    })
    const { useCase, identity, commandStore } = setup(undefined, fence)
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER_2)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin', userId: ADMIN_ACTOR })

    await useCase({ memberId: ADMIN_MEMBER.id, role: 'PropertyManager' }, ctx)

    expect(fence).toHaveBeenCalledExactlyOnceWith(
      ctx.organizationId,
      ADMIN_MEMBER.userId,
      'account_admin_role_lost',
    )
    // The demotion was already written when the connector was fenced.
    expect(roleWhenFenced).toEqual(['admin'])
  })

  it('leaves the Google connector alone when the store refuses the demotion as the last owner', async () => {
    const fence = vi.fn(async () => undefined)
    const { useCase, identity, outbox, commandStore } = setup(undefined, fence)
    // The read side still sees two AccountAdmins, so the UX guard passes; the
    // store holds one, as when a concurrent demotion of the other one won.
    identity.seedMembers([ADMIN_MEMBER_2])
    seedMemberBoth(identity, commandStore, ADMIN_MEMBER)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin', userId: ADMIN_ACTOR })

    await expect(
      useCase({ memberId: ADMIN_MEMBER.id, role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'last_owner')

    expect(fence).not.toHaveBeenCalled()
    expect(commandStore.memberById(ADMIN_MEMBER.id)?.role).toBe('owner')
    expect(outbox.byTag('identity.member.role_changed')).toHaveLength(0)
  })

  it('does not fence any Google connector for a change that demotes no AccountAdmin', async () => {
    const fence = vi.fn(async () => undefined)
    const { useCase, identity, commandStore } = setup(undefined, fence)
    seedMemberBoth(identity, commandStore, MEMBER_RECORD)
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ memberId: MEMBER_RECORD.id, role: 'PropertyManager' }, ctx)

    expect(fence).not.toHaveBeenCalled()
  })

  it('counts a multi-role owner via rawRole for the last-owner guard (H2/M4)', async () => {
    const { useCase, identity, commandStore } = setup()
    // A multi-role owner: built-in Role is null, but rawRole 'owner,editor' grants owner.
    // Previously this member crashed listMembers (toDomainRoleStrict) AND escaped the
    // last-owner guard (role !== ADMIN_ROLE). Now it must be counted as an owner.
    seedMemberBoth(identity, commandStore, {
      id: 'multi-owner',
      userId: 'user-multi',
      email: 'multi@test.com',
      name: 'Multi Owner',
      role: null,
      rawRole: 'owner,editor',
      image: null,
      createdAt: new Date('2025-01-01'),
    })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // Demoting the sole multi-role owner must be blocked — the guard fires via
    // isOwnerToken(rawRole) even though the built-in role is null.
    await expect(
      useCase({ memberId: 'multi-owner', role: 'PropertyManager' }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })
})
