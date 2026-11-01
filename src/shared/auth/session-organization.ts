import { getAuth } from './auth'
import { throwAuthError } from './auth-errors'
import { checkUserOrganizationMembership } from './user-organization-membership-authority'
import { getLogger } from '#/shared/observability/logger'

/** Shared admission before either the manager or staff role is resolved. */
export async function resolveSessionOrganization(headers: Headers) {
  const session = await getAuth().api.getSession({ headers })
  if (!session) {
    throwAuthError('unauthorized', 'Valid session required')
  }
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throwAuthError('no_active_org', 'No active organization selected')
  }

  let membershipDecision
  try {
    membershipDecision = await checkUserOrganizationMembership(
      session.user.id,
      activeOrgId,
    )
  } catch {
    throwAuthError(
      'authorization_unavailable',
      'Organization membership could not be verified',
    )
  }
  if (membershipDecision.kind === 'deny') {
    getLogger().warn(
      { reason: membershipDecision.reason },
      'auth.organization_membership_denied: session Organization is not the sole membership',
    )
    throwAuthError(
      'organization_membership_conflict',
      'This account needs Organization access assistance',
    )
  }

  return { session, activeOrgId }
}
