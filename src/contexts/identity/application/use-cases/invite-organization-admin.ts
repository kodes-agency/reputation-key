// Identity context — the operator console invites an AccountAdmin into an
// existing Organization that has none (ADR 0063).
//
// Steps:
// 1. The console may act: the Organization exists, is active and has no
//    AccountAdmin.
// 2. Persist — the ordinary invitation command commits the row and its
//    `identity.member.invited` fact (userId = the operator) atomically.
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
import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import { assertOperatorMayAdminister } from '../platform-administration'
import {
  adminInvitationCommand,
  sendAdminInvitationEmail,
  type AdminInvitationEmailDeps,
} from '../platform-admin-invitation'

export type InviteOrganizationAdminDeps = AdminInvitationEmailDeps &
  Readonly<{
    store: Pick<PlatformOrganizationStore, 'readAdministration'>
    commandStore: Pick<IdentityCommandStore, 'inviteMember'>
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
    await deps.commandStore.inviteMember(
      adminInvitationCommand(
        { invitationId, organizationId, email: input.email, operator },
        { now: deps.clock(), invitationExpiresInMs: deps.invitationExpiresInMs },
      ),
    )
    // Content-free (observability schema): the request's trace correlates
    // it, and the rows it names already record the operator as inviter.
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
