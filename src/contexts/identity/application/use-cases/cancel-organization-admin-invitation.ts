// Identity context — the operator console cancels an AccountAdmin invitation
// of an Organization that has none (ADR 0063).
//
// Cancelling needs no active Organization: withdrawing an invitation is how
// the operator stops an ownerless Organization from gaining an admin while
// it closes. The ordinary command commits the status change and its
// `identity.invitation.canceled` fact atomically.

import type { Clock } from '#/shared/domain/clock'
import {
  invitationId as toInvitationId,
  organizationId as toOrganizationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { identityInvitationCanceled } from '../../domain/events'
import type {
  OrganizationInvitationInput,
  PlatformOperatorActor,
} from '../dto/platform-console.dto'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import { assertOperatorMayAdminister } from '../platform-administration'

export type CancelOrganizationAdminInvitationDeps = Readonly<{
  store: Pick<PlatformOrganizationStore, 'readAdministration'>
  commandStore: Pick<IdentityCommandStore, 'cancelInvitation'>
  clock: Clock
  logger: Pick<LoggerPort, 'info'>
}>

export type CancelOrganizationAdminInvitation = (
  input: OrganizationInvitationInput,
  operator: PlatformOperatorActor,
) => Promise<void>

export const cancelOrganizationAdminInvitation =
  (deps: CancelOrganizationAdminInvitationDeps): CancelOrganizationAdminInvitation =>
  // The canceled fact names no actor, so the operator only gates the call.
  async (input, _operator) => {
    const organizationId = toOrganizationId(input.organizationId)
    const invitationId = toInvitationId(input.invitationId)
    const administration = await deps.store.readAdministration(organizationId)
    assertOperatorMayAdminister(administration, { requireActive: false, invitationId })

    await deps.commandStore.cancelInvitation({
      invitationId,
      organizationId,
      event: identityInvitationCanceled({
        organizationId,
        invitationId,
        occurredAt: deps.clock(),
      }),
    })
    // Content-free (observability schema): the request's trace correlates
    // it, and the rows it names already record the operator as inviter.
    deps.logger.info(
      { event: 'platform.admin_invitation_canceled' },
      'Platform operator canceled an Account Admin invitation',
    )
  }
