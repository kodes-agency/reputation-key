// Identity context — accept invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."

import { describe, it, expect } from 'vitest'
import { acceptInvitation } from './accept-invitation'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { isIdentityError } from '../../domain/errors'
import { identityError } from '../../domain/errors'
import { invitationId, userId, organizationId } from '#/shared/domain/ids'
import type { IdentityPort } from '../ports/identity.port'
import type { InvitationId, UserId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const HEADERS: Headers = new Headers()

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = acceptInvitation({ identity, events, clock: () => FIXED_TIME })
  return { useCase, identity, events }
}

const setupThrowing = () => {
  const identity: IdentityPort = {
    ...createInMemoryIdentityPort(),
    acceptInvitation: async () => {
      throw identityError('org_setup_failed', 'better-auth rejected the invitation')
    },
  }
  const events = createCapturingEventBus()
  const useCase = acceptInvitation({ identity, events, clock: () => FIXED_TIME })
  return { useCase, identity, events }
}

describe('acceptInvitation', () => {
  it('emits identity.invitation.accepted with the joined org, user, and property ids', async () => {
    const { useCase, identity, events } = setup()
    const invId: InvitationId = invitationId('inv-accept-1')
    const joiningUserId: UserId = userId('user-joining')
    const orgId = organizationId('org-joined')
    identity.seedInvitations([
      {
        id: invId as string,
        email: 'joiner@test.com',
        role: 'Staff',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        organizationId: orgId,
        propertyIds: ['prop-a', 'prop-b'],
      },
    ])

    const result = await useCase({
      invitationId: invId,
      headers: HEADERS,
      userId: joiningUserId,
    })

    // Returns the joined org id
    expect(result.organizationId).toBe(orgId)

    const emitted = events.capturedByTag('identity.invitation.accepted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].organizationId).toBe(orgId)
    expect(emitted[0].userId).toBe(joiningUserId)
    expect(emitted[0].invitationId).toBe(invId)
    expect(emitted[0].propertyIds).toEqual(['prop-a', 'prop-b'])
    expect(emitted[0].occurredAt).toBe(FIXED_TIME)
  })

  it('propagates (does not swallow) the error when the port throws', async () => {
    const { useCase, events } = setupThrowing()

    await expect(
      useCase({
        invitationId: invitationId('inv-fail'),
        headers: HEADERS,
        userId: userId('user-fail'),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'org_setup_failed',
    )

    // No event should be emitted when the accept failed.
    expect(events.capturedEvents).toHaveLength(0)
  })
})
