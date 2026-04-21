// Auth middleware for TanStack Start server functions
// Per architecture: shared/auth/ contains authMiddleware, tenantMiddleware, roleGuard.
//
// Route-level auth is done in beforeLoad using authClient.getSession()
// (see routes/_authenticated.tsx for the pattern).
// Server-function-level auth uses getAuth().api.getSession() directly.
import { getAuth } from './auth'
import type { AuthUser } from './auth'

// ── Tagged errors ──────────────────────────────────────────────────

export type AuthError = Readonly<{
  _tag: 'AuthError'
  code: 'unauthorized' | 'session_expired' | 'forbidden'
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

/**
 * Require a minimum role. Call after requireAuth to also check role.
 * Throws tagged AuthError with 'forbidden' code if role is insufficient.
 */
export function requireRole(userRole: string | undefined, minimumRole: string): void {
  const roleMap: Record<string, number> = {
    owner: 2,
    admin: 1,
    member: 0,
  }

  const userLevel = roleMap[userRole ?? 'member'] ?? 0
  const requiredLevel = roleMap[minimumRole] ?? 0

  if (userLevel < requiredLevel) {
    throw authError(
      'forbidden',
      `Role '${minimumRole}' required, but user has '${userRole ?? 'none'}'`,
    )
  }
}
