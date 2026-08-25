import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'
import { identityError, isIdentityError } from '../../domain/errors'
import { identityInvitationAccepted } from '../../domain/events'

export type RegisterInvitedUserInput = Readonly<{
  invitationId: InvitationId
  name: string
  email: string
  password: string
}>

export type RegisterInvitedUserDeps = Readonly<{
  commandStore: IdentityCommandStore
  signUp: (name: string, email: string, password: string) => Promise<string>
  deleteUser: (userId: string) => Promise<void>
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

/**
 * Invitation-bound account creation saga.
 *
 * The preflight avoids creating obviously invalid accounts; acceptance still
 * locks and revalidates the invitation after sign-up. If that authoritative
 * step loses a race or fails, deleting the new account compensates the saga.
 */
export const registerInvitedUser =
  (deps: RegisterInvitedUserDeps) =>
  async (input: RegisterInvitedUserInput): Promise<RegisterInvitedUserResult> => {
    const preflightNow = deps.clock()
    await deps.commandStore.validateInvitationRegistration({
      invitationId: input.invitationId,
      email: input.email,
      now: preflightNow,
    })

    let createdUserId: string
    try {
      createdUserId = await deps.signUp(input.name, input.email, input.password)
    } catch (error) {
      throw identityError(
        'registration_failed',
        error instanceof Error ? error.message : 'Registration failed',
      )
    }

    const acceptedUserId: UserId = toUserId(createdUserId)
    const acceptanceNow = deps.clock()
    let accepted: Awaited<ReturnType<IdentityCommandStore['acceptInvitation']>>
    try {
      accepted = await deps.commandStore.acceptInvitation({
        invitationId: input.invitationId,
        acceptorEmail: input.email,
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
        await deps.deleteUser(createdUserId)
      } catch (cleanupError) {
        deps.logger.error(
          { orphanedUserId: createdUserId, originalError: error, cleanupError },
          '[identity] invited registration compensation failed',
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
