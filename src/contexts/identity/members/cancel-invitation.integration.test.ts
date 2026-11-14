// Identity context — cancel invitation use case tests
// Per architecture: "Every use case tested for happy path + every error path."
// The status update and the canceled fact commit through the atomic identity
// command store on real PostgreSQL.

import { describe, it, expect } from 'vitest'
import { cancelInvitation } from './cancel-invitation.server'
import { createAtomicIdentityCommandStore } from '../infrastructure/identity-command-store'
import { setupIdentityMembersDb } from '#/shared/testing/identity-members-fixtures'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../domain/errors'
import { invitationId } from '#/shared/domain/ids'
import type { InvitationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const fixtures = setupIdentityMembersDb(createAtomicIdentityCommandStore)

const setup = () => {
  const store = fixtures.store()
  // The stored fact is identifier-only; the event the use case built is what
  // carries the clock reading, so it is captured on its way into the store.
  const built: Array<Parameters<typeof store.cancelInvitation>[0]['event']> = []
  const useCase = cancelInvitation({
    commandStore: {
      ...store,
      cancelInvitation: (command) => {
        built.push(command.event)
        return store.cancelInvitation(command)
      },
    },
    clock: () => FIXED_TIME,
  })
  return { useCase, built }
}

const pendingInvitation = (
  id: InvitationId,
  ctx: ReturnType<typeof buildTestAuthContext>,
  role: string,
) => ({
  id: id as string,
  organizationId: ctx.organizationId as string,
  email: 'pending@test.com',
  role,
  status: 'pending',
  expiresAt: new Date(Date.now() + 86_400_000),
  propertyIds: null,
  inviterId: ctx.userId as string,
  createdAt: new Date(),
})

describe('cancelInvitation', () => {
  it('records identity.invitation.canceled with the org and invitation id', async () => {
    const { useCase, built } = setup()
    const invId: InvitationId = invitationId('inv-cancel-1')
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await fixtures.seedInvitation(pendingInvitation(invId, ctx, 'member'))

    await useCase({ invitationId: invId }, ctx)

    const facts = await fixtures.factsByTag('identity.invitation.canceled')
    expect(facts).toHaveLength(1)
    expect(facts[0]?.payload.invitationId).toBe(invId)
    expect(facts[0]?.payload.organizationId).toBe(ctx.organizationId)
    expect(built.map((event) => event.occurredAt)).toEqual([FIXED_TIME])

    // The invitation row is marked canceled (better-auth semantics).
    expect((await fixtures.invitationById(invId as string))?.status).toBe('canceled')
  })

  it('rejects PropertyManager from canceling invitations, and cancels nothing', async () => {
    const { useCase } = setup()
    const invId: InvitationId = invitationId('inv-cancel-pm')
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    await fixtures.seedInvitation(pendingInvitation(invId, ctx, 'owner'))

    await expect(useCase({ invitationId: invId }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )

    // Manager administration is the AccountAdmin's alone (ADR 0033): even an
    // invitation this manager sent themselves stays pending.
    expect((await fixtures.invitationById(invId as string))?.status).toBe('pending')
    expect(await fixtures.facts()).toHaveLength(0)
  })

  it('rejects Member from canceling invitations', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Member' })

    await expect(useCase({ invitationId: invitationId('inv-x') }, ctx)).rejects.toSatisfy(
      (e) => isIdentityError(e) && e.code === 'forbidden',
    )
  })

  it('propagates (does not swallow) the error when the store rejects', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    await fixtures.seedOrganization(ctx.organizationId as string)

    await expect(
      useCase({ invitationId: invitationId('inv-missing') }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )

    // No fact is recorded when cancellation fails.
    expect(await fixtures.facts()).toHaveLength(0)
  })
})
