import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'
import { identityError, isIdentityError } from '../../domain/errors'
import { identityInvitationAccepted } from '../../domain/events'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'
import type { InvitedRegistrationStore } from '../ports/invited-registration-store.port'

export type RegisterInvitedUserInput = Readonly<{
  invitationId: InvitationId
  name: string
  email: string
  password: string
}>

export type RegisterInvitedUserDeps = Readonly<{
  commandStore: IdentityCommandStore
  registrationStore: InvitedRegistrationStore
  signUp: (
    name: string,
    email: string,
    password: string,
    expectedAuthIds: RegistrationAuthIds,
  ) => Promise<string>
  idGen: () => string
  runOnAccepted: (input: {
    userId: string
    organizationId: string
    propertyIds: ReadonlyArray<string>
    displayName?: string
  }) => Promise<void>
  clock: () => Date
  logger: { error: (obj: object, message?: string) => void }
}>

export type RegisterInvitedUserResult = Readonly<{
  organizationId: OrganizationId
}>

export type RegisterInvitedUser = ReturnType<typeof registerInvitedUser>

/**
 * Invitation-bound account creation saga.
 *
 * A content-free recovery fence is committed before Better Auth runs;
 * acceptance then locks and revalidates the invitation after sign-up. Any
 * interrupted boundary is reconciled only against the exact preallocated
 * provider IDs, so recovery can resume, safely compensate, or stop for review.
 */
export const registerInvitedUser =
  (deps: RegisterInvitedUserDeps) =>
  async (input: RegisterInvitedUserInput): Promise<RegisterInvitedUserResult> => {
    const preflightNow = deps.clock()
    const proposedAttemptId = deps.idGen()
    const proposedAuthIds: RegistrationAuthIds = {
      userId: deps.idGen(),
      credentialAccountId: deps.idGen(),
      initialSessionId: deps.idGen(),
    }
    const prepared = await deps.registrationStore.prepare({
      proposedAttemptId,
      invitationId: input.invitationId,
      email: input.email,
      proposedAuthIds,
      now: preflightNow,
      nextRecoveryAt: new Date(preflightNow.getTime() + 5 * 60 * 1_000),
    })
    let activeRegistration = prepared
    let expectedAuthIds = prepared.authIds
    let acceptorEmail = input.email
    let createdUserId: string
    try {
      createdUserId = await deps.signUp(
        input.name,
        input.email,
        input.password,
        expectedAuthIds,
      )
    } catch (error) {
      const recoveryNow = deps.clock()
      try {
        const recovery = await deps.registrationStore.reconcile({
          attemptId: prepared.id,
          now: recoveryNow,
          nextRecoveryAt: new Date(recoveryNow.getTime() + 5 * 60 * 1_000),
        })
        if (recovery.kind === 'ready_to_accept') {
          activeRegistration = recovery.registration
          expectedAuthIds = recovery.registration.authIds
          acceptorEmail = recovery.acceptorEmail
          createdUserId = recovery.registration.authIds.userId
        } else if (recovery.kind === 'accepted') {
          try {
            await deps.runOnAccepted({
              userId: recovery.userId,
              organizationId: recovery.organizationId as string,
              propertyIds: recovery.propertyIds,
              displayName: input.name,
            })
          } catch (hookError) {
            deps.logger.error(
              { err: hookError },
              '[identity] invited registration post-accept hook failed',
            )
          }
          return { organizationId: recovery.organizationId }
        } else {
          throw error
        }
      } catch (recoveryError) {
        const cause = recoveryError === error ? error : recoveryError
        throw identityError(
          'registration_failed',
          cause instanceof Error ? cause.message : 'Registration failed',
        )
      }
    }

    if (createdUserId !== expectedAuthIds.userId) {
      deps.logger.error(
        { expectedUserId: expectedAuthIds.userId, returnedUserId: createdUserId },
        '[identity] invited registration provider violated the user ID fence',
      )
      throw identityError(
        'registration_failed',
        'Registration provider returned an unexpected account identity',
      )
    }

    const acceptedUserId: UserId = toUserId(createdUserId)
    const acceptanceNow = deps.clock()
    let accepted: Awaited<ReturnType<IdentityCommandStore['acceptInvitation']>>
    try {
      accepted = await deps.commandStore.acceptInvitation({
        invitationId: input.invitationId,
        registrationAttemptId: activeRegistration.id,
        acceptorEmail,
        acceptorUserId: acceptedUserId,
        now: acceptanceNow,
        buildEvent: (invitation) =>
          identityInvitationAccepted({
            organizationId: invitation.organizationId,
            userId: acceptedUserId,
            invitationId: input.invitationId,
            propertyIds: invitation.propertyIds,
            occurredAt: acceptanceNow,
          }),
      })
    } catch (error) {
      try {
        const recovery = await deps.registrationStore.reconcile({
          attemptId: activeRegistration.id,
          now: acceptanceNow,
          nextRecoveryAt: new Date(acceptanceNow.getTime() + 5 * 60 * 1_000),
        })
        if (recovery.kind === 'accepted') {
          try {
            await deps.runOnAccepted({
              userId: recovery.userId,
              organizationId: recovery.organizationId as string,
              propertyIds: recovery.propertyIds,
              displayName: input.name,
            })
          } catch (hookError) {
            deps.logger.error(
              { err: hookError },
              '[identity] invited registration post-accept hook failed',
            )
          }
          return { organizationId: recovery.organizationId }
        }
      } catch (reconciliationError) {
        deps.logger.error(
          {
            registrationAttemptId: activeRegistration.id,
            err: reconciliationError,
          },
          '[identity] invited registration reconciliation failed',
        )
      }
      if (isIdentityError(error)) throw error
      throw identityError('registration_failed', 'Invitation registration failed')
    }

    // Acceptance is already authoritative. A derivative property-assignment
    // hook must never undo the account, membership, binding, or invitation.
    try {
      await deps.runOnAccepted({
        userId: createdUserId,
        organizationId: accepted.organizationId as string,
        propertyIds: accepted.propertyIds,
        displayName: input.name,
      })
    } catch (error) {
      deps.logger.error(
        { err: error },
        '[identity] invited registration post-accept hook failed',
      )
    }
    return { organizationId: accepted.organizationId }
  }
