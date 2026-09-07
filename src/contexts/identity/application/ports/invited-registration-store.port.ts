import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'

export type PreparedInvitedRegistration = Readonly<{
  verificationId: string
  invitationId: InvitationId
  organizationId: OrganizationId
  authIds: RegistrationAuthIds
}>

export type PrepareInvitedRegistration = Readonly<{
  proposedVerificationId: string
  invitationId: InvitationId
  email: string
  proposedAuthIds: RegistrationAuthIds
  now: Date
  nextRecoveryAt: Date
}>

export type ReconcileInvitedRegistrationResult =
  | Readonly<{ kind: 'awaiting_provider' | 'compensated' | 'manual_review' }>
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

/** Recovery authority stored in Better Auth's short-lived verification table. */
export type InvitedRegistrationStore = Readonly<{
  prepare(command: PrepareInvitedRegistration): Promise<PreparedInvitedRegistration>
  claimDue(
    command: Readonly<{
      now: Date
      claimExpiresAt: Date
      limit: number
    }>,
  ): Promise<ReadonlyArray<Readonly<{ verificationId: string }>>>
  complete(verificationId: string): Promise<void>
  reconcile(
    command: Readonly<{
      verificationId: string
      now: Date
      nextRecoveryAt: Date
    }>,
  ): Promise<ReconcileInvitedRegistrationResult>
}>
