// Identity context — accept invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: the member insert + invitation status update + invited Property
// access + accepted fact go through the sequential command-store fake; the
// identity port resolves the session user and aligns the session.

import { describe, it, expect, vi } from 'vitest'
import { acceptInvitation } from './accept-invitation'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { isIdentityError } from '../../domain/errors'
import { INVITATION_PAUSED_MESSAGE } from '../../domain/invitation-copy'
import { invitationId, userId, organizationId } from '#/shared/domain/ids'
import type { InvitationId, UserId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const HEADERS: Headers = new Headers()
const PROPERTY_A = 'a1000000-0000-4000-8000-00000000000a'
const PROPERTY_B = 'b2000000-0000-4000-8000-00000000000b'

const setup = (
  overrides: Partial<ReturnType<typeof createInMemoryIdentityPort>> = {},
) => {
  const identity = createInMemoryIdentityPort()
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
  commandStore.seedProperty('org-joined', PROPERTY_A)
  commandStore.seedProperty('org-joined', PROPERTY_B)
  const logger = { error: vi.fn() }
  // The capability gate's answer for an Organization; open unless a test stops it.
  const authorizeOrganization = vi.fn(async (_organizationId: string) => true)
  const useCase = acceptInvitation({
    identity: { ...identity, ...overrides },
    commandStore,
    invitations: {
      findOrganizationId: async (id) => {
        const invitation = commandStore.invitationById(id as string)
        return invitation ? organizationId(invitation.organizationId) : null
      },
    },
    authorizeOrganization,
    clock: () => FIXED_TIME,
    logger,
  })
  return { useCase, identity, outbox, commandStore, logger, authorizeOrganization }
}

const grantsOf = (
  commandStore: ReturnType<typeof setup>['commandStore'],
  joiningUserId: string,
) =>
  commandStore.allPropertyGrants
    .filter((grant) => grant.userId === joiningUserId)
    .map(({ propertyId, createdBy }) => ({ propertyId, createdBy }))

describe('acceptInvitation', () => {
  it('records identity.invitation.accepted with the joined org, user, and property ids', async () => {
    const { useCase, identity, outbox, commandStore, logger } = setup()
    const invId: InvitationId = invitationId('inv-accept-1')
    const joiningUserId: UserId = userId('user-joining')
    const orgId = organizationId('org-joined')
    identity.setSessionUser({ id: joiningUserId as string, email: 'joiner@test.com' })
    commandStore.seedInvitation({
      id: invId as string,
      organizationId: orgId as string,
      email: 'joiner@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: JSON.stringify([PROPERTY_A, PROPERTY_B]),
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
    expect(identity.activeOrganizationCalls).toEqual([orgId as string])

    // State: the invitation is accepted and the membership exists
    expect(commandStore.invitationById(invId as string)?.status).toBe('accepted')
    expect(
      commandStore.allMembers.some(
        (m) => m.userId === (joiningUserId as string) && m.organizationId === orgId,
      ),
    ).toBe(true)

    const facts = outbox.byTag('identity.invitation.accepted')
    expect(facts).toHaveLength(1)
    expect(facts[0].organizationId).toBe(orgId)
    expect(facts[0].userId).toBe(joiningUserId)
    expect(facts[0].invitationId).toBe(invId)
    expect(facts[0].propertyIds).toEqual([PROPERTY_A, PROPERTY_B])
    expect(facts[0].occurredAt).toBe(FIXED_TIME)
    // The inviter travels as an id, so Feed can tell them without a lookup.
    expect(facts[0]?.inviterId).toBe('user-inviter')

    // The acceptance itself grants the invited Properties, recorded as
    // granted by the person who sent the invitation.
    expect(grantsOf(commandStore, joiningUserId as string)).toEqual([
      { propertyId: PROPERTY_A, createdBy: 'user-inviter' },
      { propertyId: PROPERTY_B, createdBy: 'user-inviter' },
    ])
    expect(logger.error).not.toHaveBeenCalled()
    // A signed-in acceptance proves nothing about the inbox: only the
    // registration paths may verify the address.
    expect(commandStore.verifiedUserIds).toEqual([])
  })

  it('leaves the inviter off the fact and the grant when the row names none', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
    identity.setSessionUser({ id: 'user-orphan', email: 'orphan@test.com' })
    commandStore.seedInvitation({
      id: 'inv-no-inviter',
      organizationId: 'org-joined',
      email: 'orphan@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: JSON.stringify([PROPERTY_A]),
      inviterId: null,
      createdAt: new Date(),
    })

    await useCase({
      invitationId: invitationId('inv-no-inviter'),
      headers: HEADERS,
      userId: userId('user-orphan'),
    })

    const [fact] = outbox.byTag('identity.invitation.accepted')
    expect(fact).toBeDefined()
    expect(fact?.inviterId).toBeUndefined()
    expect(grantsOf(commandStore, 'user-orphan')).toEqual([
      { propertyId: PROPERTY_A, createdBy: null },
    ])
  })

  // R1B-04: the session call can fail after the commit, and an accepted
  // invitation cannot be accepted again, so nothing may wait on that call.
  it('has granted the invited Properties when aligning the session fails', async () => {
    const { useCase, identity, commandStore } = setup({
      setActiveOrganization: () => Promise.reject(new Error('session store down')),
    })
    identity.setSessionUser({ id: 'user-joining', email: 'joiner@test.com' })
    commandStore.seedInvitation({
      id: 'inv-session-down',
      organizationId: 'org-joined',
      email: 'joiner@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: JSON.stringify([PROPERTY_A, PROPERTY_B]),
      inviterId: 'user-inviter',
      createdAt: new Date(),
    })
    const input = {
      invitationId: invitationId('inv-session-down'),
      headers: HEADERS,
      userId: userId('user-joining'),
    }

    await expect(useCase(input)).rejects.toThrow('session store down')

    expect(commandStore.invitationById('inv-session-down')?.status).toBe('accepted')
    expect(grantsOf(commandStore, 'user-joining')).toEqual([
      { propertyId: PROPERTY_A, createdBy: 'user-inviter' },
      { propertyId: PROPERTY_B, createdBy: 'user-inviter' },
    ])
    await expect(useCase(input)).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )
  })

  it('accepts and logs, by count only, an invited Property it could not grant', async () => {
    const { useCase, identity, commandStore, logger } = setup()
    const deletedProperty = 'c3000000-0000-4000-8000-00000000000c'
    identity.setSessionUser({ id: 'user-joining', email: 'joiner@test.com' })
    commandStore.seedInvitation({
      id: 'inv-stale-property',
      organizationId: 'org-joined',
      email: 'joiner@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: JSON.stringify([PROPERTY_A, deletedProperty, 'not-a-property-id']),
      inviterId: 'user-inviter',
      createdAt: new Date(),
    })

    await expect(
      useCase({
        invitationId: invitationId('inv-stale-property'),
        headers: HEADERS,
        userId: userId('user-joining'),
      }),
    ).resolves.toEqual({ organizationId: 'org-joined' })

    expect(grantsOf(commandStore, 'user-joining')).toEqual([
      { propertyId: PROPERTY_A, createdBy: 'user-inviter' },
    ])
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      { failedPropertyCount: 2, requestedPropertyCount: 3 },
      'Invited property access was only partly provisioned',
    )
  })

  it('rejects when there is no active session', async () => {
    const { useCase, outbox, authorizeOrganization } = setup()

    await expect(
      useCase({
        invitationId: invitationId('inv-x'),
        headers: HEADERS,
        userId: userId('user-x'),
      }),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')

    expect(outbox.facts).toHaveLength(0)
    expect(authorizeOrganization).not.toHaveBeenCalled()
  })

  // R5G-03: a suspended or stopped Organization must not gain members.
  it("refuses, before anything is written, while the invitation's Organization may not gain members", async () => {
    const { useCase, identity, outbox, commandStore, authorizeOrganization } = setup()
    authorizeOrganization.mockResolvedValue(false)
    identity.setSessionUser({ id: 'user-joining', email: 'joiner@test.com' })
    commandStore.seedInvitation({
      id: 'inv-stopped-org',
      organizationId: 'org-joined',
      email: 'joiner@test.com',
      role: 'owner',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: null,
      inviterId: 'user-inviter',
      createdAt: new Date(),
    })

    await expect(
      useCase({
        invitationId: invitationId('inv-stopped-org'),
        headers: HEADERS,
        userId: userId('user-joining'),
      }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIdentityError(e) &&
        e.code === 'forbidden' &&
        e.message === INVITATION_PAUSED_MESSAGE,
    )

    // The decision was asked for the Organization the invitation names.
    expect(authorizeOrganization.mock.calls).toEqual([['org-joined']])
    expect(commandStore.invitationById('inv-stopped-org')?.status).toBe('pending')
    expect(commandStore.allMembers).toEqual([])
    expect(outbox.facts).toHaveLength(0)
    expect(identity.activeOrganizationCalls).toEqual([])
  })

  it('leaves an unknown invitation to the store, which refuses it', async () => {
    const { useCase, identity, authorizeOrganization } = setup()
    identity.setSessionUser({ id: 'user-joining', email: 'joiner@test.com' })

    await expect(
      useCase({
        invitationId: invitationId('inv-unknown'),
        headers: HEADERS,
        userId: userId('user-joining'),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )

    expect(authorizeOrganization).not.toHaveBeenCalled()
  })

  it('propagates (does not swallow) the error when the store rejects', async () => {
    const { useCase, identity, outbox, commandStore } = setup()
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

    // No fact is recorded and nothing is granted when acceptance fails.
    expect(outbox.facts).toHaveLength(0)
    expect(commandStore.allPropertyGrants).toEqual([])
    expect(identity.activeOrganizationCalls).toEqual([])
  })
})
