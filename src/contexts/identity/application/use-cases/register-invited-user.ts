import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'
import {
  ACCOUNT_EXISTS_MESSAGE,
  identityError,
  isIdentityError,
} from '../../domain/errors'
import { identityInvitationAccepted } from '../../domain/events'
import { providerRefusalCode } from '../provider-refusal'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'
import type {
  InvitedRegistrationStore,
  PreparedInvitedRegistration,
  ReconcileInvitedRegistrationResult,
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
 * What an invitee sees when their account could not be created. They are
 * unauthenticated and this message reaches their browser verbatim, so it is
 * fixed: a driver, query or provider error's own text can name constraints,
 * SQL and bound parameters.
 */
const REGISTRATION_FAILED_MESSAGE = 'Registration failed. Please try again.'

/**
 * Sign-up refusals the invitee can act on, keyed by the reason code Better Auth
 * puts on its refusal (`APIError.body.code`). Each gets fixed copy of our own:
 * the provider's wording is not ours to show, and its "use another email" is
 * wrong advice for an invitation bound to one address.
 */
const ACTIONABLE_SIGN_UP_REFUSALS: ReadonlyMap<string, string> = new Map([
  ['USER_ALREADY_EXISTS', ACCOUNT_EXISTS_MESSAGE],
  ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', ACCOUNT_EXISTS_MESSAGE],
  ['PASSWORD_TOO_SHORT', 'That password is too short. Choose a longer one.'],
  ['PASSWORD_TOO_LONG', 'That password is too long. Choose a shorter one.'],
  ['INVALID_EMAIL', 'Enter a valid email address.'],
])

// Names are class-like identifiers (`APIError`, `DrizzleQueryError`); codes are
// reason words or SQLSTATEs (`PASSWORD_TOO_LONG`, `23505`). Anything else is
// dropped rather than logged: both come from an `unknown` rejection, and a
// free-form value could carry the invitee's email.
const CONTENT_FREE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u
const CONTENT_FREE_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/u

type ErrorIdentity = Readonly<{ name: string | null; code: string | null }>

/** What recovery found after a failed sign-up — content-free either way. */
type SignUpRecoveryFinding =
  | Readonly<{
      recoveryOutcome: Exclude<
        ReconcileInvitedRegistrationResult['kind'],
        'ready_to_accept' | 'accepted'
      >
    }>
  | Readonly<{ reconciliationError: ErrorIdentity }>

const ownCode = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined

/**
 * A rejection's name and code for the operator log. The code is the provider's
 * refusal code, else the error's own, else its cause's — a query wrapper
 * carries the driver's SQLSTATE on `cause`.
 */
function errorIdentity(error: unknown): ErrorIdentity {
  if (!(error instanceof Error)) return { name: null, code: null }
  const code = providerRefusalCode(error) ?? ownCode(error) ?? ownCode(error.cause)
  const codeText =
    typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : code
  return {
    name: CONTENT_FREE_ERROR_NAME.test(error.name) ? error.name : null,
    code:
      typeof codeText === 'string' && CONTENT_FREE_ERROR_CODE.test(codeText)
        ? codeText
        : null,
  }
}

/**
 * Log a sign-up that could not complete — by name and code only, with what
 * recovery found — and build the error the invitee sees: fixed copy for a
 * refusal they can act on, the fixed generic message for anything else.
 */
function invitedSignUpFailure(
  deps: RegisterInvitedUserDeps,
  verificationId: string,
  signUpError: unknown,
  finding: SignUpRecoveryFinding,
): ReturnType<typeof identityError> {
  deps.logger.error(
    {
      registrationVerificationId: verificationId,
      signUpError: errorIdentity(signUpError),
      ...finding,
    },
    '[identity] invited registration sign-up failed',
  )
  const refusal = providerRefusalCode(signUpError)
  const actionable =
    refusal === null ? undefined : ACTIONABLE_SIGN_UP_REFUSALS.get(refusal)
  return identityError('registration_failed', actionable ?? REGISTRATION_FAILED_MESSAGE)
}

/**
 * Reconcile a failed sign-up against the verification record. Either the
 * provider committed exactly the preallocated records and the saga resumes,
 * or the invitation was already accepted, or the failure surfaces — as fixed
 * copy, never as the underlying error's own text.
 */
async function recoverFromSignUpFailure(
  deps: RegisterInvitedUserDeps,
  input: RegisterInvitedUserInput,
  prepared: PreparedInvitedRegistration,
  error: unknown,
): Promise<SignUpRecovery> {
  const recoveryNow = deps.clock()
  let recovery: ReconcileInvitedRegistrationResult
  try {
    recovery = await deps.registrationStore.reconcile({
      verificationId: prepared.verificationId,
      now: recoveryNow,
      nextRecoveryAt: new Date(recoveryNow.getTime() + 5 * 60 * 1_000),
    })
  } catch (reconciliationError) {
    throw invitedSignUpFailure(deps, prepared.verificationId, error, {
      reconciliationError: errorIdentity(reconciliationError),
    })
  }
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
  throw invitedSignUpFailure(deps, prepared.verificationId, error, {
    recoveryOutcome: recovery.kind,
  })
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
        // Consuming the emailed link proves the inbox: no second mail.
        markEmailVerified: true,
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

    await completeRegistrationVerification(deps, activeRegistration.verificationId)
    await runPostAcceptHook(deps, {
      userId: createdUserId,
      organizationId: accepted.organizationId as string,
      propertyIds: accepted.propertyIds,
      displayName: input.name,
    })
    return { organizationId: accepted.organizationId }
  }
