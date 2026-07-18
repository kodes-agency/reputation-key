// Identity context — accept invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: the member insert + invitation status update + accepted fact go
// through the sequential command-store fake; the identity port resolves the
// session user and records the post-acceptance hook.

import { describe, it, expect } from 'vitest'
import { acceptInvitation } from './accept-invitation'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { isIdentityError } from '../../domain/errors'
import { invitationId, userId, organizationId } from '#/shared/domain/ids'
import type { InvitationId, UserId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const HEADERS: Headers = new Headers()

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const commandStore = createSequentialIdentityCommandStore({ events })
  const useCase = acceptInvitation({ identity, commandStore, clock: () => FIXED_TIME })
  return { useCase, identity, events, commandStore }
}

describe('acceptInvitation', () => {
  it('emits identity.invitation.accepted with the joined org, user, and property ids', async () => {
    const { useCase, identity, events, commandStore } = setup()
    const invId: InvitationId = invitationId('inv-accept-1')
    const joiningUserId: UserId = userId('user-joining')
    const orgId = organizationId('org-joined')
    identity.setSessionUser({ id: joiningUserId as string, email: 'joiner@test.com' })
    commandStore.seedInvitation({
      id: invId as string,
      organizationId: orgId as string,
      email: 'joiner@test.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: JSON.stringify(['prop-a', 'prop-b']),
      inviterId: 'user-inviter',
      createdAt: new Date(),
    })

    const result = await useCase({
      invitationId: invId,
      headers: HEADERS,
      userId: joiningUserId,
    })

    // Returns the joined org id
    expect(result.organizationId).toBe(orgId)

    // State: the invitation is accepted and the membership exists
    expect(commandStore.invitationById(invId as string)?.status).toBe('accepted')
    expect(
      commandStore.allMembers.some(
        (m) => m.userId === (joiningUserId as string) && m.organizationId === orgId,
      ),
    ).toBe(true)

    const emitted = events.capturedByTag('identity.invitation.accepted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].organizationId).toBe(orgId)
    expect(emitted[0].userId).toBe(joiningUserId)
    expect(emitted[0].invitationId).toBe(invId)
    expect(emitted[0].propertyIds).toEqual(['prop-a', 'prop-b'])
    expect(emitted[0].occurredAt).toBe(FIXED_TIME)

    // Post-commit hook: staff assignments for the invited properties
    expect(identity.acceptInvitationHookCalls).toEqual([
      {
        userId: joiningUserId as string,
        organizationId: orgId as string,
        propertyIds: ['prop-a', 'prop-b'],
      },
    ])
  })

  it('rejects when there is no active session', async () => {
    const { useCase, events } = setup()

    await expect(
      useCase({
        invitationId: invitationId('inv-x'),
        headers: HEADERS,
        userId: userId('user-x'),
      }),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')

    expect(events.capturedEvents).toHaveLength(0)
  })

  it('propagates (does not swallow) the error when the store rejects', async () => {
    const { useCase, identity, events, commandStore } = setup()
    identity.setSessionUser({ id: 'user-fail', email: 'joiner@test.com' })
    commandStore.seedInvitation({
      id: 'inv-fail',
      organizationId: 'org-joined',
      email: 'joiner@test.com',
      role: 'member',
      status: 'accepted',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: null,
      inviterId: 'user-inviter',
      createdAt: new Date(),
    })

    await expect(
      useCase({
        invitationId: invitationId('inv-fail'),
        headers: HEADERS,
        userId: userId('user-fail'),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )

    // No event should be emitted when the accept failed.
    expect(events.capturedEvents).toHaveLength(0)
    expect(identity.acceptInvitationHookCalls).toHaveLength(0)
  })
})
