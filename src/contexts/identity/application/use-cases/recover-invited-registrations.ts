import { identityInvitationAccepted } from '../../domain/events'
import { userId as toUserId } from '#/shared/domain/ids'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type {
  InvitedRegistrationStore,
  ReconcileInvitedRegistrationResult,
} from '../ports/invited-registration-store.port'

export const INVITED_REGISTRATION_RECOVERY_BATCH_SIZE = 100
export const INVITED_REGISTRATION_RECOVERY_LEASE_MS = 60_000
export const INVITED_REGISTRATION_RECOVERY_RETRY_MS = 5 * 60_000

export type RecoverInvitedRegistrationsResult = Readonly<{
  claimed: number
  accepted: number
  awaitingProvider: number
  compensated: number
  manualReview: number
  claimsLost: number
  failures: number
}>

type MutableRecoveryResult = {
  -readonly [
    Key in keyof RecoverInvitedRegistrationsResult
  ]: RecoverInvitedRegistrationsResult[Key]
}

type RecoverInvitedRegistrationsDeps = Readonly<{
  registrationStore: InvitedRegistrationStore
  commandStore: Pick<IdentityCommandStore, 'acceptInvitation'>
  runOnAccepted: (
    input: Readonly<{
      userId: string
      organizationId: string
      propertyIds: ReadonlyArray<string>
    }>,
  ) => Promise<void>
  clock: () => Date
  idGen: () => string
  logger: { error: (obj: object, message?: string) => void }
}>

function recordSettlement(
  result: MutableRecoveryResult,
  settlement: ReconcileInvitedRegistrationResult,
): void {
  if (settlement.kind === 'awaiting_provider') result.awaitingProvider += 1
  else if (settlement.kind === 'compensated') result.compensated += 1
  else if (settlement.kind === 'manual_review') result.manualReview += 1
  else if (settlement.kind === 'claim_lost') result.claimsLost += 1
}

/**
 * Finish invitation registrations whose foreground request disappeared between
 * Better Auth and the atomic invitation-acceptance transaction.
 */
export const recoverInvitedRegistrations =
  (deps: RecoverInvitedRegistrationsDeps) =>
  async (): Promise<RecoverInvitedRegistrationsResult> => {
    const claimNow = deps.clock()
    const leaseOwner = deps.idGen()
    const claimed = await deps.registrationStore.claimDue({
      now: claimNow,
      leaseOwner,
      leaseExpiresAt: new Date(
        claimNow.getTime() + INVITED_REGISTRATION_RECOVERY_LEASE_MS,
      ),
      limit: INVITED_REGISTRATION_RECOVERY_BATCH_SIZE,
    })
    const result: MutableRecoveryResult = {
      claimed: claimed.length,
      accepted: 0,
      awaitingProvider: 0,
      compensated: 0,
      manualReview: 0,
      claimsLost: 0,
      failures: 0,
    }

    for (const claim of claimed) {
      try {
        const recoveryNow = deps.clock()
        let settlement = await deps.registrationStore.reconcile({
          attemptId: claim.id,
          now: recoveryNow,
          nextRecoveryAt: new Date(
            recoveryNow.getTime() + INVITED_REGISTRATION_RECOVERY_RETRY_MS,
          ),
          leaseOwner,
        })

        if (settlement.kind === 'ready_to_accept') {
          const registration = settlement.registration
          const acceptanceNow = deps.clock()
          try {
            const accepted = await deps.commandStore.acceptInvitation({
              invitationId: registration.invitationId,
              registrationAttemptId: registration.id,
              acceptorEmail: settlement.acceptorEmail,
              acceptorUserId: toUserId(registration.authIds.userId),
              now: acceptanceNow,
              buildEvent: (invitation) =>
                identityInvitationAccepted({
                  organizationId: invitation.organizationId,
                  userId: toUserId(registration.authIds.userId),
                  invitationId: registration.invitationId,
                  propertyIds: invitation.propertyIds,
                  occurredAt: acceptanceNow,
                }),
            })
            settlement = {
              kind: 'accepted',
              organizationId: accepted.organizationId,
              propertyIds: accepted.propertyIds,
              userId: registration.authIds.userId,
            }
          } catch (error) {
            // The acceptance transaction may have committed before its caller
            // observed success. Re-read exact authority before deciding.
            const settleNow = deps.clock()
            settlement = await deps.registrationStore.reconcile({
              attemptId: registration.id,
              now: settleNow,
              nextRecoveryAt: new Date(
                settleNow.getTime() + INVITED_REGISTRATION_RECOVERY_RETRY_MS,
              ),
            })
            if (settlement.kind === 'ready_to_accept') throw error
          }
        }

        if (settlement.kind === 'accepted') {
          try {
            await deps.runOnAccepted({
              userId: settlement.userId,
              organizationId: settlement.organizationId as string,
              propertyIds: settlement.propertyIds,
            })
          } catch (error) {
            // Membership and binding authority already committed. This
            // derivative access hook is independently repairable.
            deps.logger.error(
              { err: error },
              '[identity] invited registration recovery post-accept hook failed',
            )
          }
          result.accepted += 1
        } else {
          recordSettlement(result, settlement)
        }
      } catch (error) {
        result.failures += 1
        deps.logger.error(
          { err: error, registrationAttemptId: claim.id },
          '[identity] invited registration recovery attempt failed',
        )
      }
    }

    return result
  }
