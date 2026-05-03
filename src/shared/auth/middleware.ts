// Auth middleware for TanStack Start server functions
//
// Route-level auth is done in beforeLoad using authClient.getSession()
// (see routes/_authenticated.tsx for the pattern).
// Server-function-level auth uses getAuth().api.getSession() directly.
import { match } from 'ts-pattern'
import { getAuth } from './auth'
import type { AuthUser } from './auth'
import type { AuthContext } from '#/shared/domain/auth-context'
import { toDomainRole } from '#/shared/domain/roles'
import { organizationId, userId } from '#/shared/domain/ids'
import { throwContextError } from './server-errors'

// ── Request-scoped tenant cache ───────────────────────────────
// Within a single page load, multiple server functions call resolveTenantContext
// with identical cookies. This cache deduplicates the getActiveMember() DB call.
// Keyed by raw cookie header — different users/sessions get different entries.

const TENANT_CACHE_TTL_MS = 5_000 // 5 seconds — covers a single page load
const tenantCache = new Map<string, { ctx: AuthContext; ts: number }>()

function tenantCacheKey(headers: Headers): string {
  return headers.get('cookie') ?? ''
}

/** Evict expired entries from the tenant cache. Called at the end of each server function. */
export function clearTenantCache(): void {
  const now = Date.now()
  for (const [key, entry] of tenantCache) {
    if (now - entry.ts >= TENANT_CACHE_TTL_MS) {
      tenantCache.delete(key)
    }
  }
}

/** Reset the tenant cache completely. Test-only. */
export function resetTenantCache(): void {
  tenantCache.clear()
}

// ── Tagged errors ──────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type AuthError = Readonly<{
  _tag: 'AuthError'
  code: 'unauthorized' | 'session_expired' | 'forbidden' | 'no_active_org'
  message: string
}>

const authErrorStatus = (code: AuthError['code']): number =>
  match(code)
    .with('unauthorized', 'session_expired', () => 401)
    .with('forbidden', () => 403)
    .with('no_active_org', () => 400)
    .exhaustive()

function throwAuthError(code: AuthError['code'], message: string): never {
  throwContextError('AuthError', { code, message }, authErrorStatus(code))
}

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
 * Throws if user is not authenticated or has no active organization.
 */
export async function resolveTenantContext(headers: Headers): Promise<AuthContext> {
  // Check cache first
  const key = tenantCacheKey(headers)
  const cached = tenantCache.get(key)
  if (cached && Date.now() - cached.ts < TENANT_CACHE_TTL_MS) {
    return cached.ctx
  }

  const session = await getSessionFromHeaders(headers)
  if (!session) {
    throwAuthError('unauthorized', 'Valid session required')
  }

  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throwAuthError('no_active_org', 'No active organization selected')
  }

  // Find the member record for this user in the active org
  const auth = getAuth()
  const member = await auth.api.getActiveMember({ headers })
  if (!member) {
    throwAuthError('forbidden', 'Not a member of the active organization')
  }

  const ctx: AuthContext = {
    userId: userId(session.user.id),
    organizationId: organizationId(activeOrgId),
    role: toDomainRole(member.role),
  }

  tenantCache.set(key, { ctx, ts: Date.now() })
  return ctx
}
