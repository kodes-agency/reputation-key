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
 *
 * The Organization is asked before the invitation is judged, like every other
 * gated action, which answers the gate before it validates its target. So
 * while an Organization is stopped, one of its invitations that is spent,
 * cancelled, lapsed or addressed to somebody else gets the paused message too.
 * "Try again later" is wrong advice for such a link, and the answer tells the
 * holder of an invitation id that the Organization is stopped. Both are
 * accepted: no membership can result either way, and the stores give the exact
 * answer once the Organization may gain members again.
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
