import { getDb } from '#/shared/db'
import { authorizeUserOrganizationBinding } from '#/shared/db/user-organization-binding'
import type { UserOrganizationBindingDecision } from './user-organization-binding'

/** Runtime authority check used by HTTP/session entry points. */
export function checkUserOrganizationBinding(
  userId: string,
  organizationId: string,
): Promise<UserOrganizationBindingDecision> {
  return authorizeUserOrganizationBinding(getDb(), userId, organizationId)
}
