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
import { enrichSpan } from '#/shared/observability/request-context'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { can, type Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { VALID_PERMISSIONS } from './permission-catalogue'
import { BUILT_IN_ROLE_SCOPE } from './resolve-permissions'
import { resolvePermissions } from './resolve-permissions'
import { builtInPermissionsForRole } from './role-definitions'
import { fetchRoleDefinitions } from '#/shared/db/role-definitions'
import { getDb } from '#/shared/db'

// ── Request-scoped tenant cache ───────────────────────────────
// Within a single page load, multiple server functions call resolveTenantContext
// with identical sessions. This cache deduplicates the getActiveMember() DB call.
// Keyed by session cookie value only — ignores non-session cookies and ordering.
// Max-size eviction prevents unbounded memory growth under high concurrency.

const TENANT_CACHE_TTL_MS = 5_000 // 5 seconds — covers a single page load
// NOTE(F161): After an org switch, the cached tenant context may be stale for
// up to TENANT_CACHE_TTL_MS. This is acceptable because org switches are rare
// and the browser reloads on switch. If stale-cache issues arise, consider
// calling resetTenantCache() from the org-switch handler.
const TENANT_CACHE_MAX_SIZE = 100 // Evict oldest entry when full
const tenantCache = new Map<string, { ctx: AuthContext; ts: number }>()

function tenantCacheKey(headers: Headers): string | null {
  const cookie = headers.get('cookie')
  if (!cookie || cookie.trim() === '') {
    return null // Skip cache for empty cookies — prevents collision
  }
  // Extract only the session cookie value — different cookie ordering
  // or non-session cookies shouldn't create separate cache entries.
  // Better-auth uses 'better-auth.session_token' by default.
  const sessionCookie = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('better-auth.session_token='))
  return sessionCookie ?? null
}

function evictOldestIfNeeded(): void {
  if (tenantCache.size >= TENANT_CACHE_MAX_SIZE) {
    const firstKey = tenantCache.keys().next().value
    if (firstKey) {
      tenantCache.delete(firstKey)
    }
  }
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

type AuthError = Readonly<{
  _tag: 'AuthError'
  code:
    | 'unauthorized'
    | 'session_expired'
    | 'forbidden'
    | 'no_active_org'
    | 'authorization_unavailable'
  message: string
}>

const authErrorStatus = (code: AuthError['code']): number =>
  match(code)
    .with('unauthorized', 'session_expired', () => 401)
    .with('forbidden', () => 403)
    .with('no_active_org', () => 400)
    .with('authorization_unavailable', () => 503)
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
  if (key) {
    const cached = tenantCache.get(key)
    if (cached && Date.now() - cached.ts < TENANT_CACHE_TTL_MS) {
      enrichSpan({
        organizationId: cached.ctx.organizationId,
        userId: cached.ctx.userId,
        role: cached.ctx.role,
      })
      return cached.ctx
    }
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

  const role = toDomainRole(member.role)
  const env = getEnv()

  if (role === null && !env.ENABLE_CUSTOM_ROLES) {
    // Stage 1 fail-closed: a non-built-in role (custom or comma-delimited multi-role)
    // while custom roles are disabled. The warn log is the alerting anchor.
    getLogger().warn(
      { memberRole: member.role, organizationId: activeOrgId, userId: session.user.id },
      'auth.unsupported_member_role: custom role rejected while custom roles are disabled',
    )
    throwAuthError('forbidden', 'Member role is not supported')
  }

  let effectivePermissions: ReadonlySet<Permission>
  let scopeByPermission: ReadonlyMap<Permission, DataScope>

  if (env.ENABLE_CUSTOM_ROLES) {
    // Stage 2: resolve via the dynamic resolver (built-in + custom/multi roles; per-
    // permission scope, no widening). Fail-closed with 503 if role definitions can't load.
    try {
      const { customRoles, policies } = await fetchRoleDefinitions(getDb(), activeOrgId)
      const resolved = resolvePermissions({
        roleNames: member.role.split(','),
        customRoles,
        policies,
        builtInPermissions: builtInPermissionsForRole,
      })
      effectivePermissions = resolved.effectivePermissions
      scopeByPermission = resolved.scopeByPermission
    } catch (err) {
      getLogger().error(
        {
          err,
          organizationId: activeOrgId,
          userId: session.user.id,
          memberRole: member.role,
        },
        'auth.authorization_unavailable: dynamic resolver failed; fail-closed',
      )
      throwAuthError('authorization_unavailable', 'Authorization resolution failed')
    }
  } else {
    // Stage 1: built-in role, flag off — fixed scopes, no DB.
    const builtInScope: DataScope = BUILT_IN_ROLE_SCOPE[member.role] ?? 'none'
    effectivePermissions = new Set<Permission>(
      VALID_PERMISSIONS.filter((p) => can(role!, p)),
    )
    scopeByPermission = new Map<Permission, DataScope>(
      [...effectivePermissions].map((p) => [p, builtInScope] as const),
    )
  }

  const ctx: AuthContext = {
    userId: userId(session.user.id),
    organizationId: organizationId(activeOrgId),
    // Custom-only members have no built-in Role; 'Staff' is a lowest-privilege placeholder —
    // effectivePermissions/scopeByPermission are authoritative (all checks route through
    // canForContext/scopeForPermission, never ctx.role directly).
    role: role ?? 'Staff',
    effectivePermissions,
    scopeByPermission,
  }

  // Only cache if we have a valid key (non-empty cookies)
  if (key) {
    evictOldestIfNeeded()
    tenantCache.set(key, { ctx, ts: Date.now() })
  }
  enrichSpan({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    role: ctx.role,
  })
  return ctx
}
