import { APIError } from 'better-auth'
import { describe, expect, it, vi } from 'vitest'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createSequentialIdentityCommandStore } from '#/shared/testing/sequential-identity-command-store'
import { invitationId } from '#/shared/domain/ids'
import { isIdentityError } from '../../domain/errors'
import { registerInvitedUser } from './register-invited-user'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const INVITATION_ID = invitationId('inv-register-manager')

function setup(clock: () => Date = () => NOW) {
  const outbox = createRecordedOutbox()
  const commandStore = createSequentialIdentityCommandStore({ outbox })
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
      verificationId: command.proposedVerificationId,
      invitationId: command.invitationId,
      organizationId: 'org-manager' as never,
      authIds: command.proposedAuthIds,
    }
  })
  const reconcile = vi.fn().mockResolvedValue({ kind: 'awaiting_provider' })
  const claimDue = vi.fn().mockResolvedValue([])
  const complete = vi.fn().mockResolvedValue(undefined)
  const useCase = registerInvitedUser({
    commandStore: { ...commandStore, acceptInvitation },
    registrationStore: { prepare, claimDue, complete, reconcile },
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
    outbox,
    signUp,
    runOnAccepted,
    logger,
    acceptInvitation,
    prepare,
    reconcile,
    complete,
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
      proposedVerificationId: '10000000-0000-4000-8000-000000000001',
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
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('accepted')
    expect(fixture.commandStore.allMembers).toEqual([
      expect.objectContaining({
        userId: 'user-preallocated-manager',
        organizationId: 'org-manager',
        role: 'admin',
      }),
    ])
    expect(fixture.outbox.byTag('identity.invitation.accepted')).toHaveLength(1)
    expect(fixture.complete).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001')
    expect(fixture.runOnAccepted).toHaveBeenCalledWith({
      userId: 'user-preallocated-manager',
      organizationId: 'org-manager',
      propertyIds: ['property-1'],
      displayName: 'New Manager',
    })
  })

  it('preflights the email before creating an account', async () => {
    const fixture = setup()

    await expect(
      fixture.useCase({ ...fixture.input, email: 'attacker@example.com' }),
    ).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )
    expect(fixture.signUp).not.toHaveBeenCalled()
  })

  it('finishes acceptance when provider failure occurs after its fenced commit', async () => {
    const fixture = setup()
    fixture.signUp.mockRejectedValueOnce(new Error('response interrupted'))
    fixture.reconcile.mockResolvedValueOnce({
      kind: 'ready_to_accept',
      registration: {
        verificationId: '10000000-0000-4000-8000-000000000001',
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
        acceptorUserId: 'user-preallocated-manager',
      }),
    )
  })

  it('fails closed when the provider violates the fenced user ID', async () => {
    const fixture = setup()
    fixture.signUp.mockResolvedValueOnce('unexpected-provider-user')

    await expect(fixture.useCase(fixture.input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'registration_failed',
    )
    expect(fixture.acceptInvitation).not.toHaveBeenCalled()
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
      verificationId: '10000000-0000-4000-8000-000000000001',
      now: NOW,
      nextRecoveryAt: new Date('2026-08-25T12:05:00.000Z'),
    })
    expect(fixture.outbox.facts).toHaveLength(0)
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
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('pending')
  })

  it('records a recovery failure for an ambiguous provider account', async () => {
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
        registrationVerificationId: '10000000-0000-4000-8000-000000000001',
      }),
      '[identity] invited registration reconciliation failed',
    )
  })

  it('does not undo accepted authority when a derivative hook fails', async () => {
    const fixture = setup()
    fixture.runOnAccepted.mockRejectedValueOnce(new Error('assignment unavailable'))

    await expect(fixture.useCase(fixture.input)).resolves.toEqual({
      organizationId: 'org-manager',
    })
    expect(fixture.commandStore.invitationById(INVITATION_ID)?.status).toBe('accepted')
    expect(fixture.logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      '[identity] invited registration post-accept hook failed',
    )
  })
})

/**
 * An invitee is unauthenticated, and whatever this use case throws reaches
 * their browser verbatim as the registration_failed message. A driver or query
 * error's text names constraints, SQL and bound parameters, so only a fixed
 * message may leave — a known refusal the invitee can act on gets its own
 * fixed copy, and the operator gets the cause by name and code in the log.
 */
describe('registerInvitedUser sign-up failures', () => {
  const REGISTRATION_FAILED = 'Registration failed. Please try again.'

  /** What pg raises on a constraint race: the message names the constraint. */
  const uniqueViolation = () =>
    Object.assign(
      new Error('duplicate key value violates unique constraint "user_email_unique"'),
      { name: 'error', code: '23505' },
    )

  /** Drizzle's wrapper puts the SQL and its bound parameters in the message. */
  const failedQuery = () =>
    Object.assign(
      new Error(
        'Failed query: select "value" from "verification" where "verification"."email" = $1\nparams: manager@example.com',
      ),
      {
        name: 'DrizzleQueryError',
        cause: Object.assign(new Error('terminating connection'), { code: '57P01' }),
      },
    )

  const rejection = async (fixture: ReturnType<typeof setup>) =>
    fixture.useCase(fixture.input).then(
      () => {
        throw new Error('expected the registration to be refused')
      },
      (error: unknown) => error,
    )

  it('returns a fixed message, never the text of an unexpected sign-up failure', async () => {
    const fixture = setup()
    fixture.signUp.mockRejectedValueOnce(uniqueViolation())

    const error = await rejection(fixture)

    expect(error).toMatchObject({
      _tag: 'IdentityError',
      code: 'registration_failed',
      message: REGISTRATION_FAILED,
    })
    expect((error as Error).message).not.toContain('user_email_unique')
  })

  it('returns a fixed message when the reconciliation read itself fails', async () => {
    const fixture = setup()
    fixture.signUp.mockRejectedValueOnce(new Error('socket hang up'))
    fixture.reconcile.mockRejectedValueOnce(failedQuery())

    const error = await rejection(fixture)

    expect(error).toMatchObject({
      code: 'registration_failed',
      message: REGISTRATION_FAILED,
    })
    expect((error as Error).message).not.toMatch(/Failed query|manager@example\.com/u)
  })

  it.each([
    [
      'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      'UNPROCESSABLE_ENTITY',
      'User already exists. Use another email.',
      'An account already exists for this email. Sign in, then open your invitation link again.',
    ],
    [
      'USER_ALREADY_EXISTS',
      'UNPROCESSABLE_ENTITY',
      'User already exists.',
      'An account already exists for this email. Sign in, then open your invitation link again.',
    ],
    [
      'PASSWORD_TOO_SHORT',
      'BAD_REQUEST',
      'Password too short',
      'That password is too short. Choose a longer one.',
    ],
    [
      'PASSWORD_TOO_LONG',
      'BAD_REQUEST',
      'Password too long',
      'That password is too long. Choose a shorter one.',
    ],
    ['INVALID_EMAIL', 'BAD_REQUEST', 'Invalid email', 'Enter a valid email address.'],
  ] as const)(
    'keeps a clear, fixed message for the %s refusal the invitee can act on',
    async (code, status, providerMessage, expected) => {
      const fixture = setup()
      fixture.signUp.mockRejectedValueOnce(
        APIError.from(status, { code, message: providerMessage }),
      )
      fixture.reconcile.mockResolvedValueOnce({ kind: 'compensated' })

      await expect(fixture.useCase(fixture.input)).rejects.toMatchObject({
        _tag: 'IdentityError',
        code: 'registration_failed',
        message: expected,
      })
    },
  )

  it.each(['FAILED_TO_CREATE_USER', 'constructor'])(
    'gives an unrecognized provider refusal (%s) the fixed generic message',
    async (code) => {
      const fixture = setup()
      fixture.signUp.mockRejectedValueOnce(
        APIError.from('UNPROCESSABLE_ENTITY', {
          code,
          message: 'relation "user" is gone',
        }),
      )

      await expect(fixture.useCase(fixture.input)).rejects.toMatchObject({
        code: 'registration_failed',
        message: REGISTRATION_FAILED,
      })
    },
  )

  it('logs the cause by name and code only — no email, password or message text', async () => {
    const fixture = setup()
    fixture.signUp.mockRejectedValueOnce(
      Object.assign(uniqueViolation(), {
        message: 'Key (email)=(manager@example.com) already exists',
      }),
    )

    await rejection(fixture)

    expect(fixture.logger.error).toHaveBeenCalledWith(
      {
        registrationVerificationId: '10000000-0000-4000-8000-000000000001',
        signUpError: { name: 'error', code: '23505' },
        recoveryOutcome: 'awaiting_provider',
      },
      '[identity] invited registration sign-up failed',
    )
    const logged = JSON.stringify(fixture.logger.error.mock.calls)
    expect(logged).not.toMatch(/manager@example\.com|safe-password|Key \(email\)/u)
  })

  it('logs a failed reconciliation by name and its driver code', async () => {
    const fixture = setup()
    fixture.signUp.mockRejectedValueOnce(
      APIError.from('UNPROCESSABLE_ENTITY', {
        code: 'FAILED_TO_CREATE_USER',
        message: 'Failed to create user',
      }),
    )
    fixture.reconcile.mockRejectedValueOnce(failedQuery())

    await rejection(fixture)

    expect(fixture.logger.error).toHaveBeenCalledWith(
      {
        registrationVerificationId: '10000000-0000-4000-8000-000000000001',
        signUpError: { name: 'APIError', code: 'FAILED_TO_CREATE_USER' },
        reconciliationError: { name: 'DrizzleQueryError', code: '57P01' },
      },
      '[identity] invited registration sign-up failed',
    )
    expect(JSON.stringify(fixture.logger.error.mock.calls)).not.toMatch(
      /Failed query|manager@example\.com/u,
    )
  })
})
