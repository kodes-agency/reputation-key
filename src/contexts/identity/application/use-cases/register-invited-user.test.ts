import { describe, expect, it, vi } from 'vitest'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { invitationId } from '#/shared/domain/ids'
import { isIdentityError } from '../../domain/errors'
import { registerInvitedUser } from './register-invited-user'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const INVITATION_ID = invitationId('inv-register-manager')

function setup(clock: () => Date = () => NOW) {
  const events = createCapturingEventBus()
  const commandStore = createSequentialIdentityCommandStore({ events })
  commandStore.seedInvitation({
    id: INVITATION_ID as string,
    organizationId: 'org-manager',
    email: 'manager@example.com',
    role: 'admin',
    status: 'pending',
    expiresAt: new Date('2026-09-01T12:00:00.000Z'),
    propertyIds: JSON.stringify(['property-1']),
    inviterId: 'user-inviter',
    createdAt: NOW,
  })
  const signUp = vi.fn().mockResolvedValue('user-preallocated-manager')
  const deleteUser = vi.fn().mockResolvedValue(undefined)
  const runOnAccepted = vi.fn().mockResolvedValue(undefined)
  const logger = { error: vi.fn() }
  const acceptInvitation = vi.fn(commandStore.acceptInvitation)
  const generatedIds = [
    '10000000-0000-4000-8000-000000000001',
    'user-preallocated-manager',
    'account-preallocated-manager',
    'session-preallocated-manager',
  ]
  const prepare = vi.fn(async (command) => {
    await commandStore.validateInvitationRegistration({
      invitationId: command.invitationId,
      email: command.email,
      now: command.now,
    })
    return {
      id: command.proposedAttemptId,
      invitationId: command.invitationId,
      organizationId: 'org-manager' as never,
      authIds: command.proposedAuthIds,
    }
  })
  const reconcile = vi.fn().mockResolvedValue({ kind: 'awaiting_provider' })
  const claimDue = vi.fn().mockResolvedValue([])
  const useCase = registerInvitedUser({
    commandStore: { ...commandStore, acceptInvitation },
    registrationStore: { prepare, claimDue, reconcile },
    signUp,
    idGen: () => generatedIds.shift()!,
    runOnAccepted,
    clock,
    logger,
  })
  const input = {
    invitationId: INVITATION_ID,
    name: 'New Manager',
    email: 'manager@example.com',
    password: 'safe-password',
  }
  return {
    useCase,
    input,
    commandStore,
    events,
    signUp,
    deleteUser,
    runOnAccepted,
    logger,
    acceptInvitation,
    prepare,
    reconcile,
  }
}

describe('registerInvitedUser', () => {
  it('creates the account and atomically consumes its exact manager invitation', async () => {
    const fixture = setup()

    await expect(fixture.useCase(fixture.input)).resolves.toEqual({
      organizationId: 'org-manager',
    })
    expect(fixture.signUp).toHaveBeenCalledWith(
      'New Manager',
      'manager@example.com',
      'safe-password',
      {
        userId: 'user-preallocated-manager',
        credentialAccountId: 'account-preallocated-manager',
        initialSessionId: 'session-preallocated-manager',
      },
    )
    expect(fixture.prepare).toHaveBeenCalledWith({
      proposedAttemptId: '10000000-0000-4000-8000-000000000001',
      invitationId: INVITATION_ID,
      email: 'manager@example.com',
      proposedAuthIds: {
        userId: 'user-preallocated-manager',
        credentialAccountId: 'account-preallocated-manager',
        initialSessionId: 'session-preallocated-manager',
      },
      now: NOW,
      nextRecoveryAt: new Date('2026-08-25T12:05:00.000Z'),
    })
    expect(fixture.acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationAttemptId: '10000000-0000-4000-8000-000000000001',
      }),
    )
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('accepted')
    expect(fixture.commandStore.allMembers).toEqual([
      expect.objectContaining({
        userId: 'user-preallocated-manager',
        organizationId: 'org-manager',
        role: 'admin',
      }),
    ])
    expect(fixture.events.capturedByTag('identity.invitation.accepted')).toHaveLength(1)
    expect(fixture.runOnAccepted).toHaveBeenCalledWith({
      userId: 'user-preallocated-manager',
      organizationId: 'org-manager',
      propertyIds: ['property-1'],
      displayName: 'New Manager',
    })
    expect(fixture.deleteUser).not.toHaveBeenCalled()
  })

  it('preflights the email before creating an account', async () => {
    const fixture = setup()

    await expect(
      fixture.useCase({ ...fixture.input, email: 'attacker@example.com' }),
    ).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )
    expect(fixture.signUp).not.toHaveBeenCalled()
    expect(fixture.deleteUser).not.toHaveBeenCalled()
  })

  it('finishes acceptance when provider failure occurs after its fenced commit', async () => {
    const fixture = setup()
    fixture.signUp.mockRejectedValueOnce(new Error('response interrupted'))
    fixture.reconcile.mockResolvedValueOnce({
      kind: 'ready_to_accept',
      registration: {
        id: '10000000-0000-4000-8000-000000000001',
        invitationId: INVITATION_ID,
        organizationId: 'org-manager',
        authIds: {
          userId: 'user-preallocated-manager',
          credentialAccountId: 'account-preallocated-manager',
          initialSessionId: 'session-preallocated-manager',
        },
      },
      acceptorEmail: 'manager@example.com',
    })

    await expect(fixture.useCase(fixture.input)).resolves.toEqual({
      organizationId: 'org-manager',
    })
    expect(fixture.acceptInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationAttemptId: '10000000-0000-4000-8000-000000000001',
        acceptorUserId: 'user-preallocated-manager',
      }),
    )
  })

  it('fails closed without deleting an unknown account when the ID fence is violated', async () => {
    const fixture = setup()
    fixture.signUp.mockResolvedValueOnce('unexpected-provider-user')

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'registration_failed',
    )
    expect(fixture.acceptInvitation).not.toHaveBeenCalled()
    expect(fixture.deleteUser).not.toHaveBeenCalled()
    expect(fixture.logger.error).toHaveBeenCalledWith(
      {
        expectedUserId: 'user-preallocated-manager',
        returnedUserId: 'unexpected-provider-user',
      },
      '[identity] invited registration provider violated the user ID fence',
    )
  })

  it('compensates the new account if authoritative acceptance loses a race', async () => {
    const fixture = setup()
    fixture.acceptInvitation.mockRejectedValueOnce({
      _tag: 'IdentityError',
      code: 'invitation_not_found',
      message: 'Invitation is no longer pending',
    })
    fixture.reconcile.mockResolvedValueOnce({ kind: 'compensated' })

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'invitation_not_found',
    )
    expect(fixture.reconcile).toHaveBeenCalledWith({
      attemptId: '10000000-0000-4000-8000-000000000001',
      now: NOW,
      nextRecoveryAt: new Date('2026-08-25T12:05:00.000Z'),
    })
    expect(fixture.deleteUser).not.toHaveBeenCalled()
    expect(fixture.events.capturedEvents).toHaveLength(0)
  })

  it('rechecks expiry with a fresh clock value after sign-up', async () => {
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(new Date('2026-09-02T12:00:00.000Z'))
    const fixture = setup(clock)
    fixture.reconcile.mockResolvedValueOnce({ kind: 'compensated' })

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'invitation_not_found',
    )
    expect(fixture.deleteUser).not.toHaveBeenCalled()
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('pending')
  })

  it('records a recovery failure without deleting an ambiguous provider account', async () => {
    const fixture = setup()
    fixture.acceptInvitation.mockRejectedValueOnce({
      _tag: 'IdentityError',
      code: 'organization_conflict',
      message: 'Organization conflict',
    })
    fixture.reconcile.mockRejectedValueOnce(new Error('reconciliation unavailable'))

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) && error.code === 'organization_conflict',
    )
    expect(fixture.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationAttemptId: '10000000-0000-4000-8000-000000000001',
      }),
      '[identity] invited registration reconciliation failed',
    )
    expect(fixture.deleteUser).not.toHaveBeenCalled()
  })

  it('does not undo accepted authority when a derivative hook fails', async () => {
    const fixture = setup()
    fixture.runOnAccepted.mockRejectedValueOnce(new Error('assignment unavailable'))

    await expect(fixture.useCase(fixture.input)).resolves.toEqual({
      organizationId: 'org-manager',
    })
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('accepted')
    expect(fixture.deleteUser).not.toHaveBeenCalled()
    expect(fixture.logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      '[identity] invited registration post-accept hook failed',
    )
  })
})
