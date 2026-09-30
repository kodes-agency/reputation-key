// Identity context — invite member use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: state + fact go through the sequential command-store fake (same
// operation order as the atomic store) — the in-memory identity port now
// only backs the read-side (inviter name resolution).

import { describe, it, expect, vi } from 'vitest'
import { inviteMember } from './invite-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { invitationId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { InvitationEmailSender } from '../ports/invitation-email.port'
import type { PropertyNameLookup } from '../ports/invitation-read-model.port'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
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
  return { useCase, identity, outbox, commandStore, sendEmail, propertyNames, logger }
}

describe('inviteMember', () => {
  it('rejects PropertyManager invitations during the manager-only beta', async () => {
    const { useCase, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ email: 'new@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')

    expect(outbox.facts).toHaveLength(0)
  })

  it('allows AccountAdmin to invite another beta manager', async () => {
    const { useCase, commandStore, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase({ email: 'admin@test.com', role: 'AccountAdmin', propertyIds: [] }, ctx)

    expect(commandStore.allInvitations).toHaveLength(1)
    expect(commandStore.allInvitations[0].email).toBe('admin@test.com')
    // The invitation row persists the better-auth role string (BQC-3.5:
    // app-owned write path — the row matches what BA would have written).
    expect(commandStore.allInvitations[0].role).toBe('owner')
    expect(commandStore.allInvitations[0].status).toBe('pending')
    expect(commandStore.allInvitations[0].expiresAt).toEqual(
      new Date(FIXED_TIME.getTime() + INVITATION_EXPIRY_MS),
    )
    expect(outbox.facts).toHaveLength(1)
    expect(outbox.facts[0]._tag).toBe('identity.member.invited')
  })

  it('rejects Member from inviting anyone', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(
      useCase({ email: 'any@test.com', role: 'PropertyManager', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager inviting AccountAdmin', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ email: 'admin@test.com', role: 'AccountAdmin', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects when a pending invitation already exists for the email', async () => {
    const { useCase, commandStore, outbox, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    commandStore.seedInvitation({
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

    expect(outbox.facts).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not email an invite that conflicts with another Organization', async () => {
    const { useCase, commandStore, outbox, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    commandStore.seedInvitation({
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

    expect(outbox.facts).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('points the admin at Resend when this Organization holds a lapsed invitation', async () => {
    const { useCase, commandStore, outbox, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    commandStore.seedInvitation({
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

    expect(outbox.facts).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("expires another Organization's lapsed invitation and invites", async () => {
    const { useCase, commandStore } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    commandStore.seedInvitation({
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

    expect(commandStore.invitationById('inv-other-lapsed')?.status).toBe('expired')
    expect(commandStore.invitationById('inv-test-1')?.status).toBe('pending')
  })

  it('records the member.invited fact with correct data', async () => {
    const { useCase, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { email: 'new@test.com', role: 'PropertyManager', propertyIds: [] },
      ctx,
    )

    const facts = outbox.byTag('identity.member.invited')
    expect(facts).toHaveLength(1)
    expect(facts[0]).not.toHaveProperty('email')
    expect(facts[0].role).toBe('PropertyManager')
    expect(facts[0].organizationId).toBe(ctx.organizationId)
  })

  it('mails the role, the invited Properties and the lifetime after the atomic commit', async () => {
    const { useCase, sendEmail, propertyNames } = setup()
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
    const { useCase, sendEmail, commandStore, propertyNames } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { email: 'admin@test.com', role: 'AccountAdmin', propertyIds: ['prop-a'] },
      ctx,
    )

    expect(commandStore.invitationById('inv-test-1')?.propertyIds).toBeNull()
    expect(propertyNames).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'AccountAdmin', propertyNames: [] }),
    )
  })

  it('keeps the committed invitation and reports the unsent email when the send fails', async () => {
    const { useCase, sendEmail, commandStore, outbox, logger } = setup()
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

    expect(commandStore.invitationById('inv-test-1')?.status).toBe('pending')
    expect(outbox.facts).toHaveLength(1)
    expect(logger.error).toHaveBeenCalledWith(
      {
        invitationId: 'inv-test-1',
        organizationId: ctx.organizationId,
        failure: { name: 'EmailError', code: 'send_failed' },
      },
      '[identity] invitation email could not be sent',
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('new@test.com')
  })

  it('reports the unsent email when composing it fails after the commit', async () => {
    const { useCase, commandStore, propertyNames, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    propertyNames.mockRejectedValueOnce(new Error('property lookup unavailable'))

    await expect(
      useCase(
        { email: 'new@test.com', role: 'PropertyManager', propertyIds: ['prop-a'] },
        ctx,
      ),
    ).resolves.toEqual({ invitationId: 'inv-test-1', emailSent: false })

    expect(commandStore.invitationById('inv-test-1')?.status).toBe('pending')
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
