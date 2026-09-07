import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'
import { identityError, isIdentityError } from '../../domain/errors'
import { identityInvitationAccepted } from '../../domain/events'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'
import type {
  InvitedRegistrationStore,
  PreparedInvitedRegistration,
} from '../ports/invited-registration-store.port'

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
 * Acceptance is already authoritative when this runs. A derivative
 * property-assignment hook must never undo the account, membership, or
 * invitation, so its failure is observed and swallowed.
 */
async function runPostAcceptHook(
  deps: RegisterInvitedUserDeps,
  hookInput: Readonly<{
    userId: string
    organizationId: string
    propertyIds: ReadonlyArray<string>
    displayName?: string
  }>,
): Promise<void> {
  try {
    await deps.runOnAccepted(hookInput)
  } catch (hookError) {
    deps.logger.error(
      { err: hookError },
      '[identity] invited registration post-accept hook failed',
    )
  }
}

async function completeRegistrationVerification(
  deps: RegisterInvitedUserDeps,
  verificationId: string,
): Promise<void> {
  try {
    await deps.registrationStore.complete(verificationId)
  } catch (error) {
    // Acceptance already committed. The expiring verification is safe to
    // retry through recovery, while surfacing an error here would lie to the
    // user about the account that now exists.
    deps.logger.error(
      { err: error, registrationVerificationId: verificationId },
      '[identity] invited registration verification cleanup failed',
    )
  }
}

type SignUpRecovery =
  | Readonly<{
      kind: 'resume'
      registration: PreparedInvitedRegistration
      acceptorEmail: string
      createdUserId: string
    }>
  | Readonly<{ kind: 'accepted'; organizationId: OrganizationId }>

/**
 * Reconcile a failed sign-up against the verification record. Either the
 * provider committed exactly the preallocated records and the saga resumes,
 * or the invitation was already accepted, or the original failure surfaces.
 */
async function recoverFromSignUpFailure(
  deps: RegisterInvitedUserDeps,
  input: RegisterInvitedUserInput,
  prepared: PreparedInvitedRegistration,
  error: unknown,
): Promise<SignUpRecovery> {
  const recoveryNow = deps.clock()
  try {
    const recovery = await deps.registrationStore.reconcile({
      verificationId: prepared.verificationId,
      now: recoveryNow,
      nextRecoveryAt: new Date(recoveryNow.getTime() + 5 * 60 * 1_000),
    })
    if (recovery.kind === 'ready_to_accept') {
      return {
        kind: 'resume',
        registration: recovery.registration,
        acceptorEmail: recovery.acceptorEmail,
        createdUserId: recovery.registration.authIds.userId,
      }
    }
    if (recovery.kind === 'accepted') {
      await runPostAcceptHook(deps, {
        userId: recovery.userId,
        organizationId: recovery.organizationId as string,
        propertyIds: recovery.propertyIds,
        displayName: input.name,
      })
      return { kind: 'accepted', organizationId: recovery.organizationId }
    }
    throw error
  } catch (recoveryError) {
    const cause = recoveryError === error ? error : recoveryError
    throw identityError(
      'registration_failed',
      cause instanceof Error ? cause.message : 'Registration failed',
    )
  }
}

/**
 * Reconcile a failed acceptance. Returns the settled result when direct
 * Better Auth authority shows acceptance committed, and null when the caller
 * must surface the original failure.
 */
async function recoverFromAcceptanceFailure(
  deps: RegisterInvitedUserDeps,
  input: RegisterInvitedUserInput,
  activeRegistration: PreparedInvitedRegistration,
  acceptanceNow: Date,
): Promise<RegisterInvitedUserResult | null> {
  try {
    const recovery = await deps.registrationStore.reconcile({
      verificationId: activeRegistration.verificationId,
      now: acceptanceNow,
      nextRecoveryAt: new Date(acceptanceNow.getTime() + 5 * 60 * 1_000),
    })
    if (recovery.kind === 'accepted') {
      await runPostAcceptHook(deps, {
        userId: recovery.userId,
        organizationId: recovery.organizationId as string,
        propertyIds: recovery.propertyIds,
        displayName: input.name,
      })
      return { organizationId: recovery.organizationId }
    }
  } catch (reconciliationError) {
    deps.logger.error(
      {
        registrationVerificationId: activeRegistration.verificationId,
        err: reconciliationError,
      },
      '[identity] invited registration reconciliation failed',
    )
  }
  return null
}

/**
 * Invitation-bound account creation saga.
 *
 * A short-lived Better Auth verification row is committed before sign-up;
 * acceptance then locks and revalidates the invitation. Any interrupted
 * boundary is reconciled only against the exact preallocated provider IDs,
 * so recovery can resume, safely compensate, or stop for review.
 */
export const registerInvitedUser =
  (deps: RegisterInvitedUserDeps) =>
  async (input: RegisterInvitedUserInput): Promise<RegisterInvitedUserResult> => {
    const preflightNow = deps.clock()
    const proposedVerificationId = deps.idGen()
    const proposedAuthIds: RegistrationAuthIds = {
      userId: deps.idGen(),
      credentialAccountId: deps.idGen(),
      initialSessionId: deps.idGen(),
    }
    const prepared = await deps.registrationStore.prepare({
      proposedVerificationId,
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
      const recovery = await recoverFromSignUpFailure(deps, input, prepared, error)
      if (recovery.kind === 'accepted') {
        return { organizationId: recovery.organizationId }
      }
      activeRegistration = recovery.registration
      expectedAuthIds = recovery.registration.authIds
      acceptorEmail = recovery.acceptorEmail
      createdUserId = recovery.createdUserId
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
      const recovered = await recoverFromAcceptanceFailure(
        deps,
        input,
        activeRegistration,
        acceptanceNow,
      )
      if (recovered) return recovered
      if (isIdentityError(error)) throw error
      throw identityError('registration_failed', 'Invitation registration failed')
    }

    await completeRegistrationVerification(
      deps,
      activeRegistration.verificationId,
    )
    await runPostAcceptHook(deps, {
      userId: createdUserId,
      organizationId: accepted.organizationId as string,
      propertyIds: accepted.propertyIds,
      displayName: input.name,
    })
    return { organizationId: accepted.organizationId }
  }
