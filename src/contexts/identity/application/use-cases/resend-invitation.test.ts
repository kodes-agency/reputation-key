// Identity context — resend invitation use case tests.
// Resend renews the same invitation (a fresh expiry, pending again) and then
// mails it; a mail failure after the renewal reports emailSent: false.

import { describe, it, expect, vi } from 'vitest'
import { resendInvitation } from './resend-invitation'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InvitationEmailSender } from '../ports/invitation-email.port'
import type { PropertyNameLookup } from '../ports/invitation-read-model.port'

const FIXED_BASE_URL = 'http://localhost:3000'
const NOW = new Date('2026-09-30T12:00:00.000Z')
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const RENEWED_UNTIL = new Date(NOW.getTime() + TTL_MS)

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const commandStore = createSequentialIdentityCommandStore({})
  const renewInvitation = vi.fn(commandStore.renewInvitation)
  const sendEmail = vi.fn<InvitationEmailSender>().mockResolvedValue(undefined)
  const getOrganizationName = vi.fn().mockResolvedValue('Test Organization')
  const propertyNames = vi.fn<PropertyNameLookup>(async () => [
    { id: 'prop-a', name: 'Hotel A' },
  ])
  const logger = { error: vi.fn() }

  const useCase = resendInvitation({
    identity,
    commandStore: { ...commandStore, renewInvitation },
    clock: () => NOW,
    invitationExpiresInMs: TTL_MS,
    sendEmail,
    getOrganizationName,
    propertyNames,
    baseUrl: FIXED_BASE_URL,
    logger: { ...createMockLogger(), error: logger.error },
  })

  return {
    useCase,
    identity,
    commandStore,
    renewInvitation,
    sendEmail,
    getOrganizationName,
    logger,
  }
}

const seedInvitation = (
  fixture: ReturnType<typeof setup>,
  ctx: AuthContext,
  patch: Readonly<{ id?: string; status?: string; role?: string; expiresAt?: Date }> = {},
) =>
  fixture.commandStore.seedInvitation({
    id: patch.id ?? 'inv-1',
    organizationId: ctx.organizationId as string,
    email: 'invited@example.com',
    role: patch.role ?? 'admin',
    status: patch.status ?? 'pending',
    expiresAt: patch.expiresAt ?? new Date('2026-09-25T12:00:00.000Z'),
    propertyIds: JSON.stringify(['prop-a', 'prop-gone']),
    inviterId: ctx.userId as string,
    createdAt: new Date('2026-09-18T12:00:00.000Z'),
  })

describe('resendInvitation', () => {
  it('renews a lapsed invitation for another full lifetime, then mails it', async () => {
    const fixture = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    fixture.identity.seedMembers([
      {
        id: 'member-1',
        userId: ctx.userId,
        email: 'admin@example.com',
        name: 'Test Admin',
        role: 'AccountAdmin',
        rawRole: 'owner',
        image: null,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      },
    ])
    seedInvitation(fixture, ctx)

    await expect(fixture.useCase({ invitationId: 'inv-1' }, ctx)).resolves.toEqual({
      expiresAt: RENEWED_UNTIL,
      emailSent: true,
    })

    expect(fixture.renewInvitation).toHaveBeenCalledWith({
      invitationId: 'inv-1',
      organizationId: ctx.organizationId,
      now: NOW,
      expiresAt: RENEWED_UNTIL,
    })
    expect(fixture.commandStore.invitationById('inv-1')).toMatchObject({
      status: 'pending',
      expiresAt: RENEWED_UNTIL,
    })
    expect(fixture.sendEmail).toHaveBeenCalledWith({
      email: 'invited@example.com',
      invitedByUsername: 'Test Admin',
      organizationName: 'Test Organization',
      inviteLink: `${FIXED_BASE_URL}/accept-invitation?id=inv-1`,
      role: 'PropertyManager',
      propertyNames: ['Hotel A'],
      expiresInDays: 7,
    })
    expect(fixture.getOrganizationName).toHaveBeenCalledWith(ctx)
  })

  it('reopens an invitation marked expired', async () => {
    const fixture = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    seedInvitation(fixture, ctx, { status: 'expired' })

    await fixture.useCase({ invitationId: 'inv-1' }, ctx)

    expect(fixture.commandStore.invitationById('inv-1')?.status).toBe('pending')
  })

  it.each(['accepted', 'canceled'])(
    'refuses a %s invitation and mails nothing',
    async (status) => {
      const fixture = setup()
      const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
      seedInvitation(fixture, ctx, { status })

      await expect(fixture.useCase({ invitationId: 'inv-1' }, ctx)).rejects.toSatisfy(
        (e: unknown) =>
          isIdentityError(e) &&
          e.code === 'invitation_not_found' &&
          e.message === 'This invitation was already accepted or cancelled.',
      )
      expect(fixture.sendEmail).not.toHaveBeenCalled()
    },
  )

  it('keeps the renewal and reports the unsent email when the send fails', async () => {
    const fixture = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    seedInvitation(fixture, ctx)
    fixture.sendEmail.mockRejectedValueOnce(new Error('transport down'))

    await expect(fixture.useCase({ invitationId: 'inv-1' }, ctx)).resolves.toEqual({
      expiresAt: RENEWED_UNTIL,
      emailSent: false,
    })
    expect(fixture.commandStore.invitationById('inv-1')?.expiresAt).toEqual(RENEWED_UNTIL)
    expect(fixture.logger.error).toHaveBeenCalledTimes(1)
  })

  it('rejects Member from resending invitations', async () => {
    const fixture = setup()
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(fixture.useCase({ invitationId: 'inv-any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'forbidden',
    )
    expect(fixture.renewInvitation).not.toHaveBeenCalled()
  })

  it('throws invitation_not_found for an unknown invitation and mails nothing', async () => {
    const fixture = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(fixture.useCase({ invitationId: 'inv-missing' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )
    expect(fixture.sendEmail).not.toHaveBeenCalled()
  })
})
