import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'

export type PreparedInvitedRegistration = Readonly<{
  id: string
  invitationId: InvitationId
  organizationId: OrganizationId
  authIds: RegistrationAuthIds
}>

export type PrepareInvitedRegistration = Readonly<{
  proposedAttemptId: string
  invitationId: InvitationId
  email: string
  proposedAuthIds: RegistrationAuthIds
  now: Date
  nextRecoveryAt: Date
}>

export type ReconcileInvitedRegistrationResult =
  | Readonly<{
      kind: 'awaiting_provider' | 'claim_lost' | 'compensated' | 'manual_review'
    }>
  | Readonly<{
      kind: 'ready_to_accept'
      registration: PreparedInvitedRegistration
      acceptorEmail: string
    }>
  | Readonly<{
      kind: 'accepted'
      organizationId: OrganizationId
      propertyIds: ReadonlyArray<string>
      userId: string
    }>

/** Durable authority written before Better Auth begins creating records. */
export type InvitedRegistrationStore = Readonly<{
  prepare(command: PrepareInvitedRegistration): Promise<PreparedInvitedRegistration>
  claimDue(
    command: Readonly<{
      now: Date
      leaseOwner: string
      leaseExpiresAt: Date
      limit: number
    }>,
  ): Promise<ReadonlyArray<Readonly<{ id: string }>>>
  reconcile(
    command: Readonly<{
      attemptId: string
      now: Date
      nextRecoveryAt: Date
      /** Required for a worker claim; omitted by the foreground request path. */
      leaseOwner?: string
    }>,
  ): Promise<ReconcileInvitedRegistrationResult>
}>
