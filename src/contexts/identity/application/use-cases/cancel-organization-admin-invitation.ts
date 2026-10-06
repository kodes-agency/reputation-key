// Identity context — the operator console cancels an AccountAdmin invitation
// of an Organization that has none (ADR 0065).
//
// Cancelling needs no active Organization: withdrawing an invitation is how
// the operator stops an ownerless Organization from gaining an admin while
// it closes. The ordinary command commits the status change and its
// `identity.invitation.canceled` fact atomically, and the store's audit row in
// the same transaction names the operator, whom the fact does not.

import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { identityInvitationCanceled } from '../../domain/events'
import type {
  OrganizationInvitationInput,
  PlatformOperatorActor,
} from '../dto/platform-console.dto'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import { readPermittedInvitation } from '../platform-administration'

export type CancelOrganizationAdminInvitationDeps = Readonly<{
  store: Pick<PlatformOrganizationStore, 'readAdministration' | 'cancelAdminInvitation'>
  clock: Clock
  logger: Pick<LoggerPort, 'info'>
}>

export type CancelOrganizationAdminInvitation = (
  input: OrganizationInvitationInput,
  operator: PlatformOperatorActor,
) => Promise<void>

export const cancelOrganizationAdminInvitation =
  (deps: CancelOrganizationAdminInvitationDeps): CancelOrganizationAdminInvitation =>
  async (input, operator) => {
    const { organizationId, invitationId } = await readPermittedInvitation(
      deps.store,
      input,
      { requireActive: false },
    )

    await deps.store.cancelAdminInvitation(
      {
        invitationId,
        organizationId,
        event: identityInvitationCanceled({
          organizationId,
          invitationId,
          occurredAt: deps.clock(),
        }),
      },
      operator.userId,
    )
    // Content-free (observability schema): the audit row names the
    // Organization and the operator; the request's trace correlates this.
    deps.logger.info(
      { event: 'platform.admin_invitation_canceled' },
      'Platform operator canceled an Account Admin invitation',
    )
  }
