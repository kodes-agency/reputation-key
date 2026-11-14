// Identity context — invite member use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// State + fact commit through the atomic identity command store on real
// PostgreSQL; the in-memory identity port only backs the read-side (inviter
// name resolution).

import { describe, it, expect, vi } from 'vitest'
import { inviteMember } from './invite-member.server'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createAtomicIdentityCommandStore } from '../infrastructure/identity-command-store'
import { setupIdentityMembersDb } from '#/shared/testing/identity-members-fixtures'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../domain/errors'
import { invitationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { InvitationEmailSender } from '../application/ports/invitation-email.port'
import type { PropertyNameLookup } from './invitation-read-model.port.server'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

const fixtures = setupIdentityMembersDb(createAtomicIdentityCommandStore)

const setup = async () => {
  const identity = createInMemoryIdentityPort()
  const commandStore = fixtures.store()
  // The inviter and the Organization an invitation row refers to.
  const inviter = buildTestAuthContext()
  await fixtures.seedOrganization(inviter.organizationId as string)
  await fixtures.seedUser({
    id: inviter.userId as string,
    email: 'inviter@test.com',
    emailVerified: true,
  })
  const sendEmail = vi.fn<InvitationEmailSender>().mockResolvedValue(undefined)
  const propertyNames = vi.fn<PropertyNameLookup>(async () => [
    { id: 'prop-a', name: 'Hotel A' },
  ])
  const logger = { error: vi.fn() }
  const useCase = inviteMember({
    identity,
    commandStore,
    clock: () => FIXED_TIME,
    idGen: () => invitationId('inv-test-1'),
    invitationExpiresInMs: INVITATION_EXPIRY_MS,
    sendEmail,
    getOrganizationName: async () => 'Test Org',
    propertyNames,
    baseUrl: 'http://localhost:3000',
    logger: { ...createMockLogger(), error: logger.error },
  })
  return { useCase, identity, commandStore, sendEmail, propertyNames, logger }
}

describe('inviteMember', () => {
  it('rejects PropertyManager invitations during the manager-only beta', async () => {
    const { useCase } = await setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ email: 'new@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')

    expect(await fixtures.facts()).toHaveLength(0)
  })

  it('allows AccountAdmin to invite another beta manager', async () => {
    const { useCase } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ email: 'admin@test.com', role: 'AccountAdmin', propertyIds: [] }, ctx)

    const invitations = await fixtures.allInvitations()
    expect(invitations).toHaveLength(1)
    expect(invitations[0]?.email).toBe('admin@test.com')
    // The invitation row persists the better-auth role string (BQC-3.5:
    // app-owned write path — the row matches what BA would have written).
    expect(invitations[0]?.role).toBe('owner')
    expect(invitations[0]?.status).toBe('pending')
    expect(invitations[0]?.expiresAt).toEqual(
      new Date(FIXED_TIME.getTime() + INVITATION_EXPIRY_MS),
    )
    expect(await fixtures.facts()).toHaveLength(1)
    expect((await fixtures.facts())[0]?.tag).toBe('identity.member.invited')
  })

  it('rejects Member from inviting anyone', async () => {
    const { useCase } = await setup()
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(
      useCase({ email: 'any@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager inviting AccountAdmin', async () => {
    const { useCase } = await setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ email: 'admin@test.com', role: 'AccountAdmin', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects when a pending invitation already exists for the email', async () => {
    const { useCase, sendEmail } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await fixtures.seedInvitation({
      id: 'inv-existing',
      organizationId: ctx.organizationId as string,
      email: 'new@test.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date('2027-01-01'),
      propertyIds: null,
      inviterId: ctx.userId as string,
      createdAt: FIXED_TIME,
    })

    await expect(
      useCase({ email: 'new@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'already_exists')

    expect(await fixtures.facts()).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not email an invite that conflicts with another Organization', async () => {
    const { useCase, sendEmail } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await fixtures.seedInvitation({
      id: 'inv-other-org',
      organizationId: 'org-other',
      email: 'new@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date('2027-01-01'),
      propertyIds: null,
      inviterId: 'user-other',
      createdAt: FIXED_TIME,
    })

    await expect(
      useCase({ email: 'new@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) && error.code === 'organization_conflict',
    )

    expect(await fixtures.facts()).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('points the admin at Resend when this Organization holds a lapsed invitation', async () => {
    const { useCase, sendEmail } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await fixtures.seedInvitation({
      id: 'inv-lapsed',
      organizationId: ctx.organizationId as string,
      email: 'new@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date('2026-04-01T12:00:00Z'),
      propertyIds: null,
      inviterId: ctx.userId as string,
      createdAt: new Date('2026-03-25T12:00:00Z'),
    })

    await expect(
      useCase({ email: 'new@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) && e.code === 'already_exists' && /Use Resend/.test(e.message),
    )

    expect(await fixtures.facts()).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("expires another Organization's lapsed invitation and invites", async () => {
    const { useCase } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await fixtures.seedInvitation({
      id: 'inv-other-lapsed',
      organizationId: 'org-other',
      email: 'new@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date('2026-04-01T12:00:00Z'),
      propertyIds: null,
      inviterId: 'user-other',
      createdAt: new Date('2026-03-25T12:00:00Z'),
    })

    await useCase(
      { email: 'new@test.com', role: 'PropertyManager', propertyIds: [] },
      ctx,
    )

    expect((await fixtures.invitationById('inv-other-lapsed'))?.status).toBe('expired')
    expect((await fixtures.invitationById('inv-test-1'))?.status).toBe('pending')
  })

  it('records the member.invited fact with correct data', async () => {
    const { useCase } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { email: 'new@test.com', role: 'PropertyManager', propertyIds: [] },
      ctx,
    )

    const facts = await fixtures.factsByTag('identity.member.invited')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.payload).not.toHaveProperty('email')
    expect(facts[0]?.payload.role).toBe('PropertyManager')
    expect(facts[0]?.payload.organizationId).toBe(ctx.organizationId)
  })

  it('mails the role, the invited Properties and the lifetime after the atomic commit', async () => {
    const { useCase, sendEmail, propertyNames } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase(
        {
          email: 'new@test.com',
          role: 'PropertyManager',
          propertyIds: ['prop-a', 'prop-gone'],
        },
        ctx,
      ),
    ).resolves.toEqual({ invitationId: 'inv-test-1', emailSent: true })

    expect(propertyNames).toHaveBeenCalledWith(ctx.organizationId, [
      'prop-a',
      'prop-gone',
    ])
    expect(sendEmail).toHaveBeenCalledWith({
      email: 'new@test.com',
      invitedByUsername: 'Organization Admin',
      organizationName: 'Test Org',
      inviteLink: 'http://localhost:3000/accept-invitation?id=inv-test-1',
      role: 'PropertyManager',
      propertyNames: ['Hotel A'],
      expiresInDays: 7,
    })
  })

  it('stores and mails no Properties for an AccountAdmin invitation', async () => {
    const { useCase, sendEmail, propertyNames } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { email: 'admin@test.com', role: 'AccountAdmin', propertyIds: ['prop-a'] },
      ctx,
    )

    expect((await fixtures.invitationById('inv-test-1'))?.propertyIds).toBeNull()
    expect(propertyNames).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'AccountAdmin', propertyNames: [] }),
    )
  })

  it('keeps the committed invitation and reports the unsent email when the send fails', async () => {
    const { useCase, sendEmail, logger } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('Failed to send email: rejected new@test.com'), {
        name: 'EmailError',
        code: 'send_failed',
      }),
    )

    await expect(
      useCase({ email: 'new@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).resolves.toEqual({ invitationId: 'inv-test-1', emailSent: false })

    expect((await fixtures.invitationById('inv-test-1'))?.status).toBe('pending')
    expect(await fixtures.facts()).toHaveLength(1)
    expect(logger.error).toHaveBeenCalledWith(
      { failure: { name: 'EmailError', code: 'send_failed' } },
      '[identity] invitation email could not be sent',
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('new@test.com')
  })

  it('reports the unsent email when composing it fails after the commit', async () => {
    const { useCase, propertyNames, sendEmail } = await setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    propertyNames.mockRejectedValueOnce(new Error('property lookup unavailable'))

    await expect(
      useCase(
        { email: 'new@test.com', role: 'PropertyManager', propertyIds: ['prop-a'] },
        ctx,
      ),
    ).resolves.toEqual({ invitationId: 'inv-test-1', emailSent: false })

    expect((await fixtures.invitationById('inv-test-1'))?.status).toBe('pending')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
