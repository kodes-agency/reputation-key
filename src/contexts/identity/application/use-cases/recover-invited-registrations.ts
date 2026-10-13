import { identityInvitationAccepted } from '../../domain/events'
import { userId as toUserId } from '#/shared/domain/ids'
import type { AuthorizeInvitationOrganization } from '../invitation-admission'
import { reportUngrantedInvitedProperties } from '../invited-property-access'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type {
  InvitedRegistrationStore,
  ReconcileInvitedRegistrationResult,
} from '../ports/invited-registration-store.port'

const INVITED_REGISTRATION_RECOVERY_BATCH_SIZE = 100
const INVITED_REGISTRATION_RECOVERY_CLAIM_MS = 60_000
const INVITED_REGISTRATION_RECOVERY_RETRY_MS = 5 * 60_000

export type RecoverInvitedRegistrationsResult = Readonly<{
  claimed: number
  accepted: number
  /** Ready to accept but left alone: the Organization may not gain members now. */
  denied: number
  awaitingProvider: number
  compensated: number
  manualReview: number
  failures: number
}>

/** What the schedule that runs a recovery pass hands it. */
export type RecoverInvitedRegistrationsRun = Readonly<{
  /**
   * Current capability policy for one Organization (ADR 0032). The schedule is
   * tenant-cross and only enumerates, so each acceptance asks first.
   */
  authorizeOrganization: AuthorizeInvitationOrganization
}>

type MutableRecoveryResult = {
  -readonly [
    Key in keyof RecoverInvitedRegistrationsResult
  ]: RecoverInvitedRegistrationsResult[Key]
}

type RecoverInvitedRegistrationsDeps = Readonly<{
  registrationStore: InvitedRegistrationStore
  commandStore: Pick<IdentityCommandStore, 'acceptInvitation'>
  clock: () => Date
  logger: { error: (obj: object, message?: string) => void }
}>

type ReadyRegistration = Extract<
  ReconcileInvitedRegistrationResult,
  { kind: 'ready_to_accept' }
>

/** How one claimed registration ended this pass. */
type ClaimOutcome =
  Exclude<ReconcileInvitedRegistrationResult['kind'], 'ready_to_accept'> | 'denied'

const COUNTER_BY_OUTCOME = {
  accepted: 'accepted',
  denied: 'denied',
  awaiting_provider: 'awaitingProvider',
  compensated: 'compensated',
  manual_review: 'manualReview',
} as const satisfies Record<ClaimOutcome, keyof RecoverInvitedRegistrationsResult>

function reconcile(
  deps: RecoverInvitedRegistrationsDeps,
  verificationId: string,
): Promise<ReconcileInvitedRegistrationResult> {
  const now = deps.clock()
  return deps.registrationStore.reconcile({
    verificationId,
    now,
    nextRecoveryAt: new Date(now.getTime() + INVITED_REGISTRATION_RECOVERY_RETRY_MS),
  })
}

async function completeVerification(
  deps: RecoverInvitedRegistrationsDeps,
  verificationId: string,
): Promise<void> {
  try {
    await deps.registrationStore.complete(verificationId)
  } catch (error) {
    // Acceptance is already authoritative. Leaving this expiring
    // verification for the next reconciliation is safe.
    deps.logger.error(
      { err: error, registrationVerificationId: verificationId },
      '[identity] invited registration verification cleanup failed',
    )
  }
}

/** Accept a registration whose sign-up finished and whose acceptance did not. */
async function acceptReadyRegistration(
  deps: RecoverInvitedRegistrationsDeps,
  ready: ReadyRegistration,
): Promise<ClaimOutcome> {
  const { registration } = ready
  const acceptanceNow = deps.clock()
  try {
    const accepted = await deps.commandStore.acceptInvitation({
      invitationId: registration.invitationId,
      acceptorEmail: ready.acceptorEmail,
      acceptorUserId: toUserId(registration.authIds.userId),
      now: acceptanceNow,
      // The same registration: its acceptance verifies the address.
      markEmailVerified: true,
      buildEvent: (invitation) =>
        identityInvitationAccepted({
          organizationId: invitation.organizationId,
          userId: toUserId(registration.authIds.userId),
          invitationId: registration.invitationId,
          propertyIds: invitation.propertyIds,
          inviterId: invitation.inviterId ?? undefined,
          occurredAt: acceptanceNow,
        }),
    })
    reportUngrantedInvitedProperties(deps.logger, accepted, {
      registrationVerificationId: registration.verificationId,
    })
  } catch (error) {
    // The acceptance transaction may have committed before its caller
    // observed success. Re-read exact authority before deciding.
    const settlement = await reconcile(deps, registration.verificationId)
    if (settlement.kind === 'ready_to_accept') throw error
    return settlement.kind
  }
  await completeVerification(deps, registration.verificationId)
  return 'accepted'
}

/** Settle one claimed registration under current policy. */
async function settleClaim(
  deps: RecoverInvitedRegistrationsDeps,
  run: RecoverInvitedRegistrationsRun,
  verificationId: string,
): Promise<ClaimOutcome> {
  const settlement = await reconcile(deps, verificationId)
  if (settlement.kind !== 'ready_to_accept') return settlement.kind
  // Accepting creates a membership, so current policy is asked for that
  // Organization first. A refused registration keeps its recovery record and
  // comes due again: it is finished once the Organization may gain members,
  // or compensated when its invitation lapses.
  const admitted = await run.authorizeOrganization(settlement.registration.organizationId)
  return admitted ? acceptReadyRegistration(deps, settlement) : 'denied'
}

/**
 * Finish invitation registrations whose foreground request disappeared between
 * Better Auth and the atomic invitation-acceptance transaction. The acceptance
 * commits the membership together with the invited Property access, so a
 * settled registration needs nothing more from this pass.
 */
export const recoverInvitedRegistrations =
  (deps: RecoverInvitedRegistrationsDeps) =>
  async (
    run: RecoverInvitedRegistrationsRun,
  ): Promise<RecoverInvitedRegistrationsResult> => {
    const claimNow = deps.clock()
    const claimed = await deps.registrationStore.claimDue({
      now: claimNow,
      claimExpiresAt: new Date(
        claimNow.getTime() + INVITED_REGISTRATION_RECOVERY_CLAIM_MS,
      ),
      limit: INVITED_REGISTRATION_RECOVERY_BATCH_SIZE,
    })
    const result: MutableRecoveryResult = {
      claimed: claimed.length,
      accepted: 0,
      denied: 0,
      awaitingProvider: 0,
      compensated: 0,
      manualReview: 0,
      failures: 0,
    }

    for (const claim of claimed) {
      try {
        const outcome = await settleClaim(deps, run, claim.verificationId)
        result[COUNTER_BY_OUTCOME[outcome]] += 1
      } catch (error) {
        result.failures += 1
        deps.logger.error(
          { err: error, registrationVerificationId: claim.verificationId },
          '[identity] invited registration recovery failed',
        )
      }
    }

    return result
  }
