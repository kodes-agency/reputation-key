// Identity context — invite member use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: state + fact go through the sequential command-store fake (same
// operation order as the atomic store) — the in-memory identity port now
// only backs the read-side (inviter name resolution).

import { describe, it, expect, vi } from 'vitest'
import { inviteMember } from './invite-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { invitationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const commandStore = createSequentialIdentityCommandStore({ events })
  const sendEmail = vi.fn().mockResolvedValue(undefined)
  const useCase = inviteMember({
    identity,
    commandStore,
    clock: () => FIXED_TIME,
    idGen: () => invitationId('inv-test-1'),
    invitationExpiresInMs: INVITATION_EXPIRY_MS,
    sendEmail,
    getOrganizationName: async () => 'Test Org',
    baseUrl: 'http://localhost:3000',
  })
  return { useCase, identity, events, commandStore, sendEmail }
}

describe('inviteMember', () => {
  it('allows PropertyManager to invite a Staff member', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ email: 'new@test.com', role: 'Staff', propertyIds: [] }, ctx)

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('identity.member.invited')
  })

  it('allows AccountAdmin to invite with any role', async () => {
    const { useCase, commandStore, events } = setup()
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
    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('identity.member.invited')
  })

  it('rejects Staff from inviting anyone', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ email: 'any@test.com', role: 'Staff', propertyIds: [] }, ctx),
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
    const { useCase, commandStore, events, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
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
      useCase({ email: 'new@test.com', role: 'Staff', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'already_exists')

    expect(events.capturedEvents).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('emits member.invited event with correct data', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ email: 'new@test.com', role: 'Staff', propertyIds: [] }, ctx)

    const emitted = events.capturedByTag('identity.member.invited')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].email).toBe('new@test.com')
    expect(emitted[0].role).toBe('Staff')
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
  })

  it('sends the invitation email after the atomic commit (BA parity)', async () => {
    const { useCase, sendEmail } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ email: 'new@test.com', role: 'Staff', propertyIds: [] }, ctx)

    expect(sendEmail).toHaveBeenCalledWith({
      email: 'new@test.com',
      invitedByUsername: 'Organization Admin',
      organizationName: 'Test Org',
      inviteLink: 'http://localhost:3000/accept-invitation?id=inv-test-1',
    })
  })
})
