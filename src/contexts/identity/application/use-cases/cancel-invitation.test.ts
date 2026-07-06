// Identity context — cancel invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect } from 'vitest'
import { cancelInvitation } from './cancel-invitation'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError, identityError } from '../../domain/errors'
import { invitationId } from '#/shared/domain/ids'
import type { IdentityPort } from '../ports/identity.port'
import type { InvitationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const HEADERS: Headers = new Headers()

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = cancelInvitation({ identity, events, clock: () => FIXED_TIME })
  return { useCase, identity, events }
}

const setupThrowing = () => {
  const identity: IdentityPort = {
    ...createInMemoryIdentityPort(),
    cancelInvitation: async () => {
      throw identityError('org_setup_failed', 'better-auth failed to cancel')
    },
  }
  const events = createCapturingEventBus()
  const useCase = cancelInvitation({ identity, events, clock: () => FIXED_TIME })
  return { useCase, identity, events }
}

describe('cancelInvitation', () => {
  it('emits identity.invitation.canceled with the org and invitation id', async () => {
    const { useCase, identity, events } = setup()
    const invId: InvitationId = invitationId('inv-cancel-1')
    identity.seedInvitations([
      {
        id: invId as string,
        email: 'pending@test.com',
        role: 'Staff',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        propertyIds: [],
      },
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ invitationId: invId, headers: HEADERS }, ctx)

    const emitted = events.capturedByTag('identity.invitation.canceled')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].invitationId).toBe(invId)
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
    expect(emitted[0].occurredAt).toBe(FIXED_TIME)

    // The port actually removed the invitation.
    expect(identity.allInvitations).toHaveLength(0)
  })

  it('rejects Staff from canceling invitations', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ invitationId: invitationId('inv-x'), headers: HEADERS }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('propagates (does not swallow) the error when the port throws', async () => {
    const { useCase, events } = setupThrowing()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ invitationId: invitationId('inv-fail'), headers: HEADERS }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'org_setup_failed',
    )

    // No event should be emitted when the cancel failed.
    expect(events.capturedEvents).toHaveLength(0)
  })
})
