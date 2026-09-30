// Identity context — the operator console renews and resends an
// AccountAdmin invitation of an Organization that has none (ADR 0063).
//
// Steps:
// 1. The console may act: an active Organization with no AccountAdmin, and
//    the invitation is one of its open AccountAdmin invitations.
// 2. Renew — the command store renews the same row (pending or expired) for
//    a full lifetime and re-runs its guards; it records no fact.
// 3. Send to the renewed address post-commit; a failure reports
//    `emailSent: false`.

import type { Clock } from '#/shared/domain/clock'
import {
  invitationId as toInvitationId,
  organizationId as toOrganizationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  OrganizationInvitationInput,
  PlatformOperatorActor,
  ResendOrganizationAdminInvitationResult,
} from '../dto/platform-console.dto'
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import { assertOperatorMayAdminister } from '../platform-administration'
import {
  sendAdminInvitationEmail,
  type AdminInvitationEmailDeps,
} from '../platform-admin-invitation'

export type ResendOrganizationAdminInvitationDeps = AdminInvitationEmailDeps &
  Readonly<{
    store: Pick<PlatformOrganizationStore, 'readAdministration'>
    commandStore: Pick<IdentityCommandStore, 'renewInvitation'>
    clock: Clock
    logger: Pick<LoggerPort, 'info' | 'error'>
  }>

export type ResendOrganizationAdminInvitation = (
  input: OrganizationInvitationInput,
  operator: PlatformOperatorActor,
) => Promise<ResendOrganizationAdminInvitationResult>

export const resendOrganizationAdminInvitation =
  (deps: ResendOrganizationAdminInvitationDeps): ResendOrganizationAdminInvitation =>
  async (input, operator) => {
    const organizationId = toOrganizationId(input.organizationId)
    const invitationId = toInvitationId(input.invitationId)
    const administration = await deps.store.readAdministration(organizationId)
    assertOperatorMayAdminister(administration, { requireActive: true, invitationId })

    const now = deps.clock()
    const renewed = await deps.commandStore.renewInvitation({
      invitationId,
      organizationId,
      now,
      expiresAt: new Date(now.getTime() + deps.invitationExpiresInMs),
    })
    deps.logger.info(
      {
        event: 'platform.admin_invitation_resent',
        operatorUserId: operator.userId,
        organizationId,
        invitationId,
      },
      'Platform operator renewed an Account Admin invitation',
    )

    const emailSent = await sendAdminInvitationEmail(deps, {
      invitationId,
      email: renewed.email,
      organizationName: administration.name,
      operator,
    })
    return { expiresAt: renewed.expiresAt.toISOString(), emailSent }
  }
