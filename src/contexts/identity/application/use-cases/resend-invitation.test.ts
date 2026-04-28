// Identity context — resend invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect, vi } from 'vitest'
import { resendInvitation } from './resend-invitation'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'

const FIXED_BASE_URL = 'http://localhost:3000'

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const sendEmail = vi.fn().mockResolvedValue(undefined)
  const getOrganizationName = vi.fn().mockResolvedValue('Test Organization')

  const useCase = resendInvitation({
    identity,
    sendEmail,
    getOrganizationName,
    baseUrl: FIXED_BASE_URL,
  })

  return { useCase, identity, sendEmail, getOrganizationName }
}

describe('resendInvitation', () => {
  it('resends an invitation email with the current user name', async () => {
    const { useCase, identity, sendEmail, getOrganizationName } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    identity.seedMembers([
      {
        id: 'member-1',
        userId: ctx.userId,
        email: 'manager@example.com',
        name: 'Test Manager',
        role: 'PropertyManager',
        image: null,
        createdAt: new Date('2026-04-01T00:00:00Z'),
      },
    ])

    identity.seedInvitations([
      {
        id: 'inv-1',
        email: 'invited@example.com',
        role: 'Staff',
        status: 'pending',
        expiresAt: new Date('2026-05-01T00:00:00Z'),
        createdAt: new Date('2026-04-01T00:00:00Z'),
        organizationId: organizationId(ctx.organizationId),
      },
    ])

    const result = await useCase({ invitationId: 'inv-1' }, ctx)

    expect(result.success).toBe(true)
    expect(sendEmail).toHaveBeenCalledWith({
      email: 'invited@example.com',
      invitedByUsername: 'Test Manager',
      organizationName: 'Test Organization',
      inviteLink: `${FIXED_BASE_URL}/accept-invitation?id=inv-1`,
    })
    expect(getOrganizationName).toHaveBeenCalledWith(ctx)
  })

  it('allows AccountAdmin to resend invitations', async () => {
    const { useCase, identity } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    identity.seedInvitations([
      {
        id: 'inv-2',
        email: 'admin-invited@example.com',
        role: 'PropertyManager',
        status: 'pending',
        expiresAt: new Date('2026-05-01T00:00:00Z'),
        createdAt: new Date('2026-04-01T00:00:00Z'),
        organizationId: organizationId(ctx.organizationId),
      },
    ])

    const result = await useCase({ invitationId: 'inv-2' }, ctx)
    expect(result.success).toBe(true)
  })

  it('rejects Staff from resending invitations', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ invitationId: 'inv-any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('throws invitation_not_found when invitation does not exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    // No invitations seeded

    await expect(useCase({ invitationId: 'inv-missing' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )
  })

  it('does not send email when invitation is not found', async () => {
    const { useCase, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    try {
      await useCase({ invitationId: 'inv-missing' }, ctx)
    } catch {
      // expected
    }

    expect(sendEmail).not.toHaveBeenCalled()
  })
})
