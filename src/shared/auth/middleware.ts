// Auth middleware for TanStack Start server functions
//
// Route-level auth is done in beforeLoad using authClient.getSession()
// (see routes/_authenticated.tsx for the pattern).
// Server-function-level auth uses getAuth().api.getSession() directly.
import { getAuth } from './auth'
import type { AuthUser } from './auth'
import type { AuthContext } from '#/shared/domain/auth-context'
import { throwAuthError } from './auth-errors'
import { resolveTenant, resetTenantResolutionCache } from './tenant-resolver'
import { enterTenantScope } from '#/shared/db/tenant-scope.server'
import { getSpanAttrs } from '#/shared/observability/request-context'

// The tenant-resolution pipeline (session decode → per-request memo → tenant-cache
// freshness decision table → member + built-in role authority) lives in the
// TenantResolver module (./tenant-resolver). This file keeps the public surface the
// 46 server files import; nothing here knows about cache keys, TTL, or the
// permission_version protocol.

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
 * Delegates to the TenantResolver module — see ./tenant-resolver.ts — and
 * gives the rest of the request that Organization's database scope.
 *
 * Throws if user is not authenticated or has no active organization.
 */
export async function resolveTenantContext(headers: Headers): Promise<AuthContext> {
  const ctx = await resolveTenant(headers)
  enterTenantScope({
    organizationId: ctx.organizationId,
    entry: 'session',
    name: getSpanAttrs().useCase ?? 'session',
  })
  return ctx
}

/** Reset the tenant cache completely. Test-only. */
export function resetTenantCache(): void {
  resetTenantResolutionCache()
}
