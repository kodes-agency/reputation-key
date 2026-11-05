// TenantResolver — deep module behind resolveTenantContext.
//
// Owns the staged tenant-resolution pipeline so the middleware delegate (and its
// ~46 server-function callers) know nothing about:
//   1. per-request memoization (ALS RequestContext)
//   2. session decode + active-org extraction
//   3. tenant-cache key construction, TTL, and max-size eviction
//   4. the permission_version freshness protocol
//   5. built-in role authority (fixed permissions and data scope per role)
//   6. span-enrichment points
//
// Cache freshness decision table (pure — see decideTenantCacheAction /
// versionedEntryIsFresh, unit-tested directly):
//
//   cached?  TTL-fresh?  versioned?  version match?  → outcome
//   no       —           —           —                → resolve fresh
//   yes      no          —           —                → resolve fresh
//   yes      yes         no          —                → resolve fresh
//   yes      yes         yes         yes              → serve
//   yes      yes         yes         no / unreadable  → drop entry, resolve fresh

import { getAuth } from './auth'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'
import { toDomainRole } from '#/shared/domain/roles'
import { organizationId, userId } from '#/shared/domain/ids'
import { throwAuthError } from './auth-errors'
import { enrichSpan, getRequestContext } from '#/shared/observability/request-context'
import { getLogger } from '#/shared/observability/logger'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { BUILT_IN_ROLE_SCOPE, builtInPermissionsForRole } from './role-definitions'
import {
  fetchPermissionVersion,
  type RoleDefinitionDatabase,
} from '#/shared/db/role-definitions'
import { getDb } from '#/shared/db'
import { resolveSessionOrganization } from './session-organization'
import { isBetaInteractiveMemberRoleToken } from '#/shared/domain/beta-interactive-role'

import {
  recordTenantCacheEviction,
  recordTenantCacheHit,
  recordTenantCacheMiss,
  registerTenantCacheSizeReader,
  resetTenantCacheStats,
} from './tenant-cache-stats'

// ── Request-scoped tenant cache ───────────────────────────────
// Within a single page load, multiple server functions call resolveTenantContext
// with identical sessions. This cache deduplicates the getActiveMember() DB call.
// Keyed per (session cookie, active org) so an org switch resolves a fresh entry
// rather than serving the prior org's context. Max-size eviction prevents
// unbounded memory growth under high concurrency.

export const TENANT_CACHE_TTL_MS = 60_000 // 60s — version check (permission_version) is the primary freshness guard. Covers multi-fn page loads + short user sessions on stable permissions. See auth-caching-improvements plan.
// Keyed on (session cookie, orgId): after an org switch A→B the new request uses a
// different key, so the cache never leaks org A's AuthContext into B's resolution.
const TENANT_CACHE_MAX_SIZE = 100 // Evict oldest entry when full

export type TenantCacheEntry = Readonly<{
  ctx: AuthContext
  ts: number
  version: number | null
}>

const tenantCache = new Map<string, TenantCacheEntry>()

// BQC-7.3: the health side reads cache.tenant.* via the light stats module —
// it never imports this module (the auth stack stays out of health).
registerTenantCacheSizeReader(() => tenantCache.size)

function tenantCacheKey(headers: Headers, activeOrgId: string): string | null {
  const cookie = headers.get('cookie')
  if (!cookie || cookie.trim() === '') {
    return null // Skip cache for empty cookies — prevents collision
  }
  // Extract only the session cookie value — different cookie ordering
  // or non-session cookies shouldn't create separate cache entries.
  // Better Auth 1.6.23 prefixes the production cookie with `__Secure-` for
  // HTTPS base URLs and its own parser prefers that name when both are sent.
  // Keep the cache identity aligned with the session decoder: otherwise the
  // production cache is inert, or a stale legacy cookie can alias two secure
  // sessions that happen to arrive in the same header.
  const cookiePairs = cookie.split(';').map((c) => c.trim())
  const sessionCookie = [
    '__Secure-better-auth.session_token=',
    'better-auth.session_token=',
  ]
    .map((prefix) => cookiePairs.find((pair) => pair.startsWith(prefix)))
    .find((pair) => pair !== undefined && pair.slice(pair.indexOf('=') + 1) !== '')
  // Combine with the active org so an org switch resolves under a fresh key.
  return sessionCookie ? `${sessionCookie}|${activeOrgId}` : null
}

function evictOldestIfNeeded(): void {
  if (tenantCache.size >= TENANT_CACHE_MAX_SIZE) {
    const firstKey = tenantCache.keys().next().value
    if (firstKey) {
      tenantCache.delete(firstKey)
      recordTenantCacheEviction()
    }
  }
}

/** Reset the tenant cache completely. Test-only. */
export function resetTenantResolutionCache(): void {
  tenantCache.clear()
  resetTenantCacheStats()
}

// ── Freshness decision table (pure) ────────────────────────────

export type TenantCacheAction = 'resolve-fresh' | 'serve' | 'check-version'

/**
 * cached? × TTL-fresh? × versioned? → what to do with the cache entry.
 * 'check-version' defers to versionedEntryIsFresh once the org's current
 * permission_version has been read (the only async input).
 */
export function decideTenantCacheAction(
  entry: TenantCacheEntry | undefined,
  now: number,
): TenantCacheAction {
  if (!entry || now - entry.ts >= TENANT_CACHE_TTL_MS) {
    return 'resolve-fresh'
  }
  // Built-in authorization without a permission_version proof is never served
  // across requests: membership removal and role downgrade must be visible on
  // the next command, not after the cache TTL.
  return entry.version === null ? 'resolve-fresh' : 'check-version'
}

/**
 * permission_version match? → serve / drop-and-re-resolve.
 * A null currentVersion means the read failed — can't prove freshness, so the
 * entry is stale (fail-closed; the re-resolve 503s if the DB is down).
 */
export function versionedEntryIsFresh(
  cachedVersion: number,
  currentVersion: number | null,
): boolean {
  return currentVersion !== null && currentVersion === cachedVersion
}

// ── Cache serve path ───────────────────────────────────────────

function serveEntry(entry: TenantCacheEntry): AuthContext {
  enrichSpan({ role: entry.ctx.role })
  return entry.ctx
}

/**
 * Prove a versioned entry against the org's current permission_version. A bump
 * means roles, grants or membership changed and the cached ctx is stale; a read
 * failure is treated the same. Either way the entry is dropped and the caller
 * falls through to a full re-resolve.
 */
async function readCurrentPermissionVersion(orgId: string): Promise<number | null> {
  try {
    return await fetchPermissionVersion(getDb(), orgId)
  } catch {
    return null // Can't prove freshness — fail-closed
  }
}

async function versionedEntryStillCurrent(
  key: string,
  entry: TenantCacheEntry,
): Promise<boolean> {
  const current = await readCurrentPermissionVersion(
    entry.ctx.organizationId as unknown as string,
  )
  if (entry.version !== null && versionedEntryIsFresh(entry.version, current)) {
    return true
  }
  tenantCache.delete(key)
  recordTenantCacheEviction()
  return false
}

/** Serve a fresh cached context for the key, or null when the table says re-resolve. */
async function tryServeFromCache(key: string): Promise<AuthContext | null> {
  const entry = tenantCache.get(key)
  const action = decideTenantCacheAction(entry, Date.now())
  if (action === 'resolve-fresh' || !entry) {
    recordTenantCacheMiss()
    return null
  }
  if (action === 'check-version' && !(await versionedEntryStillCurrent(key, entry))) {
    recordTenantCacheMiss()
    return null
  }
  recordTenantCacheHit()
  return serveEntry(entry)
}

// ── Built-in role authority ────────────────────────────────────

type MemberAuthorization = Readonly<{
  domainRole: Role
  effectivePermissions: ReadonlySet<Permission>
  scopeByPermission: ReadonlyMap<Permission, DataScope>
  permissionVersion: number
}>

/**
 * A member's authority: the fixed permissions and data scope of their built-in
 * role, stamped with the organization's current permission_version. A role that
 * is not built in is refused. An unreadable version fails closed (503): a cached
 * context could not be proved fresh, and a delayed worker would act on authority
 * it cannot date.
 */
async function resolveMemberAuthorization(
  memberRole: string,
  orgId: string,
  database: RoleDefinitionDatabase,
): Promise<MemberAuthorization> {
  const domainRole = toDomainRole(memberRole)
  if (domainRole === null) {
    // The warn log is the alerting anchor: no Member Role other than the three
    // built-in tokens is assigned, so a hit means a role was written around the app.
    getLogger().warn(
      { memberRole },
      'auth.unsupported_member_role: member role is not a built-in role',
    )
    throwAuthError('forbidden', 'Member role is not supported')
  }
  let permissionVersion: number
  try {
    permissionVersion = await fetchPermissionVersion(database, orgId)
  } catch (err) {
    getLogger().error(
      { err, memberRole },
      'auth.authorization_unavailable: permission version unreadable; fail-closed',
    )
    throwAuthError('authorization_unavailable', 'Authorization resolution failed')
  }
  const effectivePermissions = builtInPermissionsForRole(memberRole)
  const scope: DataScope = BUILT_IN_ROLE_SCOPE[memberRole] ?? 'none'
  return {
    domainRole,
    effectivePermissions,
    scopeByPermission: new Map<Permission, DataScope>(
      [...effectivePermissions].map((p) => [p, scope] as const),
    ),
    permissionVersion,
  }
}

function buildAuthContext(
  rawUserId: string,
  activeOrgId: string,
  authz: MemberAuthorization,
): AuthContext {
  const ctx: AuthContext = {
    userId: userId(rawUserId),
    organizationId: organizationId(activeOrgId),
    role: authz.domainRole,
    effectivePermissions: Object.freeze(authz.effectivePermissions),
    scopeByPermission: Object.freeze(authz.scopeByPermission),
  }
  // Freeze ctx so a caller can't reassign a field and poison the shared cache entry —
  // the same object is returned to other callers within the TTL. The Set/Map fields are
  // frozen above; ReadonlySet/Map give type-level immutability, Object.freeze adds
  // runtime protection against property reassignment on the shared instance.
  Object.freeze(ctx)
  return ctx
}

/**
 * Resolve the same authorization shape used by interactive requests from a
 * durable organization/member identity. Delayed workers call this only after
 * an organization-scoped membership lookup; no session state is reconstructed.
 */
export async function resolveMemberAuthContext(
  input: Readonly<{
    memberRole: string
    organizationId: string
    userId: string
  }>,
): Promise<Readonly<{ context: AuthContext; permissionVersion: number }>> {
  return resolveMemberAuthContextWithDatabase(getDb(), input)
}

/** Resolve a durable member using the caller's transaction snapshot. */
export async function resolveMemberAuthContextWithDatabase(
  database: RoleDefinitionDatabase,
  input: Readonly<{
    memberRole: string
    organizationId: string
    userId: string
  }>,
): Promise<Readonly<{ context: AuthContext; permissionVersion: number }>> {
  const authorization = await resolveMemberAuthorization(
    input.memberRole,
    input.organizationId,
    database,
  )
  return {
    context: buildAuthContext(input.userId, input.organizationId, authorization),
    permissionVersion: authorization.permissionVersion,
  }
}

// ── The pipeline ───────────────────────────────────────────────

/**
 * Resolve the tenant context for a request: session → cache → member + role → ctx.
 * Throws tagged AuthErrors (unauthorized / no_active_org / forbidden /
 * authorization_unavailable) on failure.
 */
export async function resolveTenant(headers: Headers): Promise<AuthContext> {
  // Stage 0 — per-request memoization (AC-03): if the same traced server fn calls
  // us twice (or downstream code re-resolves), return the already-resolved value.
  const reqCtx = getRequestContext()
  if (reqCtx?.resolvedTenantCtx) {
    return reqCtx.resolvedTenantCtx
  }

  const { session, activeOrgId } = await resolveSessionOrganization(headers)

  // Stage 1 — tenant-cache freshness decision table. Keyed per (session, org) so
  // an org switch A→B resolves fresh instead of serving org A's context.
  const key = tenantCacheKey(headers, activeOrgId)
  if (key) {
    const cached = await tryServeFromCache(key)
    if (cached) {
      return cached
    }
  }

  // Stage 2 — fresh resolution: member record + built-in role authority.
  const member = await getAuth().api.getActiveMember({ headers })
  if (!member) {
    throwAuthError('forbidden', 'Not a member of the active organization')
  }
  if (!isBetaInteractiveMemberRoleToken(member.role)) {
    getLogger().warn(
      { memberRole: member.role },
      'auth.beta_role_inactive: account has no active beta manager role',
    )
    throwAuthError(
      'beta_role_inactive',
      'This account is not enabled for beta manager access',
    )
  }
  const resolved = await resolveMemberAuthContext({
    memberRole: member.role,
    organizationId: activeOrgId,
    userId: session.user.id,
  })
  const ctx = resolved.context

  // Stage 3 — cache (only with a valid key, i.e. non-empty cookies) + memo + span.
  if (key) {
    evictOldestIfNeeded()
    tenantCache.set(key, { ctx, ts: Date.now(), version: resolved.permissionVersion })
  }
  const reqCtx2 = getRequestContext()
  if (reqCtx2) {
    reqCtx2.resolvedTenantCtx = ctx
  }
  enrichSpan({ role: ctx.role })
  return ctx
}
