// Activity context — identity-backed user lookup adapter
// Resolves actor names/avatars/roles via the identity port.
// Falls back to 'System' on any failure — activity log is best-effort.

import type { UserLookupPort, UserInfo } from '../../ports/user-lookup.port'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'
import { userId, organizationId } from '#/shared/domain/ids'

const FALLBACK_USER: UserInfo = Object.freeze({
  name: 'System',
  avatarUrl: null,
  role: 'Staff' as Role,
})

function deriveAuthContext(userIdStr: string, orgIdStr: string): AuthContext {
  return {
    userId: userId(userIdStr),
    organizationId: organizationId(orgIdStr),
    role: 'Staff' as Role,
  }
}

export const createIdentityUserLookupAdapter = (
  identityPort: IdentityPort,
): UserLookupPort => ({
  lookup: async (userId: string, orgId: string): Promise<UserInfo> => {
    try {
      const ctx = deriveAuthContext(userId, orgId)
      const member = await identityPort.getMember(ctx, userId)
      if (!member) return FALLBACK_USER
      return {
        name: member.name,
        avatarUrl: member.image,
        role: member.role,
      }
    } catch {
      return FALLBACK_USER
    }
  },
})
