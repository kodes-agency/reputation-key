// Auth middleware for TanStack Start server functions
//
// Route-level auth is done in beforeLoad using authClient.getSession()
// (see routes/_authenticated.tsx for the pattern).
// Server-function-level auth uses getAuth().api.getSession() directly.
import { getAuth } from './auth'
import type { AuthUser } from './auth'
import type { AuthContext } from '#/shared/domain/auth-context'
import { throwAuthError } from './auth-errors'
import {
  resolveTenant,
  evictExpiredTenantEntries,
  resetTenantResolutionCache,
} from './tenant-resolver'

// The tenant-resolution pipeline (session decode → per-request memo → tenant-cache
// freshness decision table → member + role strategy) lives in the TenantResolver
// module (./tenant-resolver). This file keeps the public surface the 46 server
// files import; nothing here knows about cache keys, TTL, the permission_version
// protocol, or the ENABLE_CUSTOM_ROLES branch.

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
    throwAuthError('unauthorized', 'Valid session required')
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
 * Thin delegate to the TenantResolver module — see ./tenant-resolver.ts.
 *
 * Throws if user is not authenticated or has no active organization.
 */
export async function resolveTenantContext(headers: Headers): Promise<AuthContext> {
  return resolveTenant(headers)
}

/** Evict expired entries from the tenant cache. No longer called unconditionally after every server function (see auth-caching plan). */
export function clearTenantCache(): void {
  evictExpiredTenantEntries()
}

/** Reset the tenant cache completely. Test-only. */
export function resetTenantCache(): void {
  resetTenantResolutionCache()
}
