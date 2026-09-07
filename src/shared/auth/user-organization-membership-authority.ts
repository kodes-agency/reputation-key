import { getDb } from '#/shared/db'
import { authorizeUserOrganizationMembership } from '#/shared/db/user-organization-membership'
import type { UserOrganizationMembershipDecision } from './user-organization-membership'

/** Runtime authority check used by HTTP/session entry points. */
export function checkUserOrganizationMembership(
  userId: string,
  organizationId: string,
): Promise<UserOrganizationMembershipDecision> {
  return authorizeUserOrganizationMembership(getDb(), userId, organizationId)
}
