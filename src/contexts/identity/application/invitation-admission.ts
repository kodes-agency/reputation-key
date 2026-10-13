// Identity context — may this invitation be consumed now?
//
// Consuming an invitation writes a standing membership. A joiner has no tenant
// context yet, so the capability decision every other Organization write takes
// (ADR 0032) is asked here for the Organization the invitation belongs to: the
// kill switch, an Organization suspension and isolated restore mode refuse.

import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import { identityError } from '../domain/errors'
import { INVITATION_PAUSED_MESSAGE } from '../domain/invitation-copy'
import type { InvitationReadModel } from './ports/invitation-read-model.port'

/**
 * Current capability policy for one Organization: may it gain members through
 * an invitation? Interactive paths ask the execution policy; the recovery job
 * asks the authorizer of its own schedule.
 */
export type AuthorizeInvitationOrganization = (
  organizationId: OrganizationId,
) => Promise<boolean>

export type InvitationAdmissionDeps = Readonly<{
  invitations: Pick<InvitationReadModel, 'findOrganizationId'>
  authorizeOrganization: AuthorizeInvitationOrganization
}>

/**
 * Refuse, before anything is written, an invitation whose Organization may not
 * gain members now. An invitation that does not exist passes: the stores
 * refuse it in their own words, and no membership can come of it.
 */
export async function assertInvitationOrganizationAdmits(
  deps: InvitationAdmissionDeps,
  invitationId: InvitationId,
): Promise<void> {
  const organizationId = await deps.invitations.findOrganizationId(invitationId)
  if (organizationId === null) return
  if (await deps.authorizeOrganization(organizationId)) return
  throw identityError('forbidden', INVITATION_PAUSED_MESSAGE)
}
