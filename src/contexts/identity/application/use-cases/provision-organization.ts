// Identity context — the operator console creates an Organization and
// invites its first AccountAdmin (ADR 0063).
//
// Steps:
// 1. Validate — the name, and the slug (given, or derived from the name).
// 2. Persist — ONE transaction: the Organization (not joined by the
//    operator), its first AccountAdmin invitation and that invitation's
//    `identity.member.invited` fact. A refused invitation creates nothing.
// 3. Send the email post-commit; a failure reports `emailSent: false`.
//
// Provisioning records no fact of its own, as `ops:bootstrap-owner` records
// none. The rows are the record — the operator is the invitation's
// inviterId — and a content-free log line marks the change in its trace.

import type { Clock } from '#/shared/domain/clock'
import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { deriveOrganizationSlug } from '#/shared/domain/organization-slug'
import { validateOrganizationName, validateSlug } from '../../domain/rules'
import type {
  PlatformOperatorActor,
  ProvisionOrganizationInput,
  ProvisionOrganizationResult,
} from '../dto/platform-console.dto'
import type { PlatformOrganizationStore } from '../ports/platform-organization-store.port'
import {
  adminInvitationCommand,
  sendAdminInvitationEmail,
  type AdminInvitationEmailDeps,
} from '../platform-admin-invitation'

export type ProvisionOrganizationDeps = AdminInvitationEmailDeps &
  Readonly<{
    store: Pick<PlatformOrganizationStore, 'provisionOrganization'>
    clock: Clock
    newOrganizationId: () => OrganizationId
    newInvitationId: () => InvitationId
    logger: Pick<LoggerPort, 'info' | 'error'>
  }>

export type ProvisionOrganization = (
  input: ProvisionOrganizationInput,
  operator: PlatformOperatorActor,
) => Promise<ProvisionOrganizationResult>

export const provisionOrganization =
  (deps: ProvisionOrganizationDeps): ProvisionOrganization =>
  async (input, operator) => {
    const name = validateOrganizationName(input.name)
    if (name.isErr()) throw name.error
    const slug = validateSlug(input.slug ?? deriveOrganizationSlug(name.value))
    if (slug.isErr()) throw slug.error

    const organizationId = deps.newOrganizationId()
    const invitationId = deps.newInvitationId()
    const now = deps.clock()
    await deps.store.provisionOrganization({
      organizationId,
      name: name.value,
      slug: slug.value,
      now,
      firstAdmin: adminInvitationCommand(
        { invitationId, organizationId, email: input.adminEmail, operator },
        { now, invitationExpiresInMs: deps.invitationExpiresInMs },
      ),
    })
    // Content-free (observability schema): the request's trace correlates
    // it, and the rows it names already record the operator as inviter.
    deps.logger.info(
      { event: 'platform.organization_provisioned' },
      'Platform operator created an Organization and invited its first Account Admin',
    )

    const emailSent = await sendAdminInvitationEmail(deps, {
      invitationId,
      email: input.adminEmail,
      organizationName: name.value,
      operator,
    })
    return { organizationId, slug: slug.value, invitationId, emailSent }
  }
