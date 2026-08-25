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
  const signUp = vi.fn().mockResolvedValue('user-new-manager')
  const deleteUser = vi.fn().mockResolvedValue(undefined)
  const runOnAccepted = vi.fn().mockResolvedValue(undefined)
  const logger = { error: vi.fn() }
  const acceptInvitation = vi.fn(commandStore.acceptInvitation)
  const useCase = registerInvitedUser({
    commandStore: { ...commandStore, acceptInvitation },
    signUp,
    deleteUser,
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
    )
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('accepted')
    expect(fixture.commandStore.allMembers).toEqual([
      expect.objectContaining({
        userId: 'user-new-manager',
        organizationId: 'org-manager',
        role: 'admin',
      }),
    ])
    expect(fixture.events.capturedByTag('identity.invitation.accepted')).toHaveLength(1)
    expect(fixture.runOnAccepted).toHaveBeenCalledWith({
      userId: 'user-new-manager',
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

  it('compensates the new account if authoritative acceptance loses a race', async () => {
    const fixture = setup()
    fixture.acceptInvitation.mockRejectedValueOnce({
      _tag: 'IdentityError',
      code: 'invitation_not_found',
      message: 'Invitation is no longer pending',
    })

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'invitation_not_found',
    )
    expect(fixture.deleteUser).toHaveBeenCalledWith('user-new-manager')
    expect(fixture.events.capturedEvents).toHaveLength(0)
  })

  it('rechecks expiry with a fresh clock value after sign-up', async () => {
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(new Date('2026-09-02T12:00:00.000Z'))
    const fixture = setup(clock)

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'invitation_not_found',
    )
    expect(fixture.deleteUser).toHaveBeenCalledWith('user-new-manager')
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('pending')
  })

  it('records an orphan for support if compensation itself fails', async () => {
    const fixture = setup()
    fixture.acceptInvitation.mockRejectedValueOnce({
      _tag: 'IdentityError',
      code: 'organization_conflict',
      message: 'Organization conflict',
    })
    fixture.deleteUser.mockRejectedValueOnce(new Error('delete failed'))

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) && error.code === 'organization_conflict',
    )
    expect(fixture.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ orphanedUserId: 'user-new-manager' }),
      '[identity] invited registration compensation failed',
    )
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
