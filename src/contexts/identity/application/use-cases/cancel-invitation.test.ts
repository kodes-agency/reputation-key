// Identity context — cancel invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// BQC-3.5: the status update + canceled fact go through the sequential
// command-store fake.

import { describe, it, expect } from 'vitest'
import { cancelInvitation } from './cancel-invitation'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'
import { invitationId } from '#/shared/domain/ids'
import type { InvitationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
  const useCase = cancelInvitation({ commandStore, clock: () => FIXED_TIME })
  return { useCase, outbox, commandStore }
}

describe('cancelInvitation', () => {
  it('records identity.invitation.canceled with the org and invitation id', async () => {
    const { useCase, outbox, commandStore } = setup()
    const invId: InvitationId = invitationId('inv-cancel-1')
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    commandStore.seedInvitation({
      id: invId as string,
      organizationId: ctx.organizationId as string,
      email: 'pending@test.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      propertyIds: null,
      inviterId: ctx.userId as string,
      createdAt: new Date(),
    })

    await useCase({ invitationId: invId }, ctx)

    const facts = outbox.byTag('identity.invitation.canceled')
    expect(facts).toHaveLength(1)
    expect(facts[0].invitationId).toBe(invId)
    expect(facts[0].organizationId).toBe(ctx.organizationId)
    expect(facts[0].occurredAt).toBe(FIXED_TIME)

    // The invitation row is marked canceled (better-auth semantics).
    expect(commandStore.invitationById(invId as string)?.status).toBe('canceled')
  })

  it('rejects Staff from canceling invitations', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ invitationId: invitationId('inv-x') }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('propagates (does not swallow) the error when the store rejects', async () => {
    const { useCase, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase({ invitationId: invitationId('inv-missing') }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )

    // No fact is recorded when cancellation fails.
    expect(outbox.facts).toHaveLength(0)
  })
})
