import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'

/** Organization Google credentials may only be managed by org-wide authority. */
export function canManageOrganizationGoogleConnections(actor: AuthContext): boolean {
  return (
    canForContext(actor, 'integration.manage') &&
    scopeForPermission(actor, 'integration.manage') === 'organization'
  )
}
