// Identity context — the operator console invites an AccountAdmin into an
// existing Organization that has none (ADR 0065).
//
// Steps:
// 1. The console may act: the Organization exists, is active and has no
//    AccountAdmin.
// 2. Persist — the ordinary invitation command commits the row and its
//    `identity.member.invited` fact (userId = the operator) atomically, with
//    an audit row naming the operator and the Organization.
// 3. Send the email post-commit; a failure reports `emailSent: false`.

import type { Clock } from '#/shared/domain/clock'
import {
  organizationId as toOrganizationId,
  type InvitationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  InviteOrganizationAdminInput,
  InviteOrganizationAdminResult,
  PlatformOperatorActor,
} from '../dto/platform-console.dto'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import { assertOperatorMayAdminister } from '../platform-administration'
import {
  adminInvitationCommand,
  sendAdminInvitationEmail,
  type AdminInvitationEmailDeps,
} from '../platform-admin-invitation'

export type InviteOrganizationAdminDeps = AdminInvitationEmailDeps &
  Readonly<{
    store: Pick<PlatformOrganizationStore, 'readAdministration' | 'inviteAdmin'>
    clock: Clock
    idGen: () => InvitationId
    logger: Pick<LoggerPort, 'info' | 'error'>
  }>

export type InviteOrganizationAdmin = (
  input: InviteOrganizationAdminInput,
  operator: PlatformOperatorActor,
) => Promise<InviteOrganizationAdminResult>

export const inviteOrganizationAdmin =
  (deps: InviteOrganizationAdminDeps): InviteOrganizationAdmin =>
  async (input, operator) => {
    const organizationId = toOrganizationId(input.organizationId)
    const administration = await deps.store.readAdministration(organizationId)
    assertOperatorMayAdminister(administration, { requireActive: true })

    const invitationId = deps.idGen()
    await deps.store.inviteAdmin(
      adminInvitationCommand(
        { invitationId, organizationId, email: input.email, operator },
        { now: deps.clock(), invitationExpiresInMs: deps.invitationExpiresInMs },
      ),
    )
    // Content-free (observability schema): the audit row names the
    // Organization and the operator; the request's trace correlates this.
    deps.logger.info(
      { event: 'platform.admin_invited' },
      'Platform operator invited an Account Admin',
    )

    const emailSent = await sendAdminInvitationEmail(deps, {
      invitationId,
      email: input.email,
      organizationName: administration.name,
      operator,
    })
    return { invitationId, emailSent }
  }
