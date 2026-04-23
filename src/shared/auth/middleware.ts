// Auth middleware for TanStack Start server functions
// Per architecture: shared/auth/ contains authMiddleware, tenantMiddleware, roleGuard.
//
// Route-level auth is done in beforeLoad using authClient.getSession()
// (see routes/_authenticated.tsx for the pattern).
// Server-function-level auth uses getAuth().api.getSession() directly.
import { getAuth } from './auth'
import type { AuthUser } from './auth'
import type { AuthContext } from '#/shared/domain/auth-context'
import { ROLE_HIERARCHY, toDomainRole } from '#/shared/domain/roles'
import type { Role } from '#/shared/domain/roles'
import { organizationId, userId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'

// ── Tagged errors ──────────────────────────────────────────────────

export type AuthError = Readonly<{
  _tag: 'AuthError'
  code: 'unauthorized' | 'session_expired' | 'forbidden' | 'no_active_org'
  message: string
}>

const authError = (code: AuthError['code'], message: string): AuthError => ({
  _tag: 'AuthError',
  code,
  message,
})

// ── Helpers ─────────────────────────────────────────────────────────

/** Extract user from request headers (server-side only). Returns null if no session. */
export async function getUserFromHeaders(headers: Headers): Promise<AuthUser | null> {
  const auth = getAuth()
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  return session.user as AuthUser
}

/** Get full session from request headers (server-side only). */
export function getSessionFromHeaders(headers: Headers) {
  const auth = getAuth()
  return auth.api.getSession({ headers })
}

/**
 * Require authentication in a server function.
 * Returns the user if authenticated, throws a tagged AuthError otherwise.
 *
 * Per conventions: application layer throws tagged errors.
 * Server functions catch and translate them to HTTP responses.
 */
export async function requireAuth(headers: Headers): Promise<AuthUser> {
  const user = await getUserFromHeaders(headers)
  if (!user) {
    throw authError('unauthorized', 'Valid session required')
  }
  return user
}

// ── tenantMiddleware ────────────────────────────────────────────────

/**
 * Resolve tenant context from the session's active organization.
 * Returns AuthContext with userId, organizationId, and role.
 *
 * Per architecture: "tenantMiddleware resolves org from session
 * and attaches to AuthContext."
 *
 * Throws if user is not authenticated or has no active organization.
 */
export async function resolveTenantContext(headers: Headers): Promise<AuthContext> {
  const session = await getSessionFromHeaders(headers)
  if (!session) {
    throw authError('unauthorized', 'Valid session required')
  }

  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throw authError('no_active_org', 'No active organization selected')
  }

  // Find the member record for this user in the active org
  const auth = getAuth()
  const member = await auth.api.getActiveMember({ headers })
  if (!member) {
    throw authError('forbidden', 'Not a member of the active organization')
  }

  return {
    userId: userId(session.user.id),
    organizationId: organizationId(activeOrgId) as OrganizationId,
    role: toDomainRole(member.role),
  }
}

// ── roleGuard ───────────────────────────────────────────────────────

/**
 * Create a role guard that checks minimum role against the hierarchy.
 * Per architecture: "roleGuard(minRole) middleware factory that checks role against a hierarchy"
 *
 * Usage:
 *   roleGuard('PropertyManager')(ctx)  → allows PropertyManager + AccountAdmin, blocks Staff
 *   roleGuard('AccountAdmin')(ctx)     → allows only AccountAdmin
 */
export function roleGuard(minRole: Role) {
  return (ctx: AuthContext): void => {
    if (ROLE_HIERARCHY[ctx.role] < ROLE_HIERARCHY[minRole]) {
      throw authError(
        'forbidden',
        `Role '${minRole}' required, but you have '${ctx.role}'`,
      )
    }
  }
}
