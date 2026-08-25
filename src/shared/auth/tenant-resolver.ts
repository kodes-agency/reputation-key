// TenantResolver — deep module behind resolveTenantContext.
//
// Owns the staged tenant-resolution pipeline so the middleware delegate (and its
// ~46 server-function callers) know nothing about:
//   1. per-request memoization (ALS RequestContext)
//   2. session decode + active-org extraction
//   3. tenant-cache key construction, TTL, and max-size eviction
//   4. the permission_version freshness protocol (Stage 2 DAC)
//   5. the built-in-vs-custom role strategy (selected once per resolution by env flag)
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
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { can, type Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { VALID_PERMISSIONS } from './permission-catalogue'
import { BUILT_IN_ROLE_SCOPE, resolvePermissions } from './resolve-permissions'
import { builtInPermissionsForRole } from './role-definitions'
import {
  fetchRoleDefinitions,
  fetchPermissionVersion,
} from '#/shared/db/role-definitions'
import { getDb, type Database } from '#/shared/db'
import { checkUserOrganizationBinding } from './user-organization-binding-authority'
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

function tenantCacheKey(
  headers: Headers,
  activeOrgId: string,
  bindingVersion: number,
): string | null {
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
  return sessionCookie
    ? `${sessionCookie}|${activeOrgId}|binding:${bindingVersion}`
    : null
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
 * Stage 2 (DAC): prove a versioned entry against the org's current
 * permission_version. A bump means roles/policies/assignments changed and the
 * cached ctx is stale; a read failure is treated the same. Either way the entry
 * is dropped and the caller falls through to a full re-resolve.
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

// ── Role resolution strategy ───────────────────────────────────

type RoleStrategy = 'built-in-only' | 'dynamic'

/** Selected once per resolution from the env flag — callers never branch on it. */
function selectRoleStrategy(customRolesEnabled: boolean): RoleStrategy {
  return customRolesEnabled ? 'dynamic' : 'built-in-only'
}

type MemberAuthorization = Readonly<{
  domainRole: Role | null
  effectivePermissions: ReadonlySet<Permission>
  scopeByPermission: ReadonlyMap<Permission, DataScope>
  permissionVersion: number | null
}>

/** Stage 1: built-in role, flag off — fixed scopes, no DB. Fail-closed on custom roles. */
function resolveBuiltInAuthorization(
  memberRole: string,
  domainRole: Role | null,
): MemberAuthorization {
  if (domainRole === null) {
    // Stage 1 fail-closed: a non-built-in role (custom or comma-delimited multi-role)
    // while custom roles are disabled. The warn log is the alerting anchor.
    getLogger().warn(
      { memberRole },
      'auth.unsupported_member_role: custom role rejected while custom roles are disabled',
    )
    throwAuthError('forbidden', 'Member role is not supported')
  }
  const builtInScope: DataScope = BUILT_IN_ROLE_SCOPE[memberRole] ?? 'none'
  const effectivePermissions = new Set<Permission>(
    VALID_PERMISSIONS.filter((p) => can(domainRole, p)),
  )
  const scopeByPermission = new Map<Permission, DataScope>(
    [...effectivePermissions].map((p) => [p, builtInScope] as const),
  )
  return { domainRole, effectivePermissions, scopeByPermission, permissionVersion: null }
}

/** Stage 2: dynamic resolver (built-in + custom/multi roles; per-permission scope). */
async function resolveDynamicAuthorization(
  memberRole: string,
  domainRole: Role | null,
  context: { activeOrgId: string; userId: string },
  database: Database = getDb(),
): Promise<MemberAuthorization> {
  // Fail-closed with 503 if role definitions can't load.
  try {
    const permissionVersion = await fetchPermissionVersion(database, context.activeOrgId)
    const { customRoles, policies } = await fetchRoleDefinitions(
      database,
      context.activeOrgId,
    )
    const resolved = resolvePermissions({
      roleNames: memberRole.split(','),
      customRoles,
      policies,
      builtInPermissions: builtInPermissionsForRole,
    })
    return {
      domainRole,
      effectivePermissions: resolved.effectivePermissions,
      scopeByPermission: resolved.scopeByPermission,
      permissionVersion,
    }
  } catch (err) {
    getLogger().error(
      {
        err,
        memberRole,
      },
      'auth.authorization_unavailable: dynamic resolver failed; fail-closed',
    )
    throwAuthError('authorization_unavailable', 'Authorization resolution failed')
  }
}

function resolveMemberAuthorization(input: {
  memberRole: string
  activeOrgId: string
  userId: string
}): Promise<MemberAuthorization> {
  const domainRole = toDomainRole(input.memberRole)
  const context = { activeOrgId: input.activeOrgId, userId: input.userId }
  if (selectRoleStrategy(getEnv().ENABLE_CUSTOM_ROLES) === 'dynamic') {
    return resolveDynamicAuthorization(input.memberRole, domainRole, context)
  }
  return Promise.resolve(resolveBuiltInAuthorization(input.memberRole, domainRole))
}

function buildAuthContext(
  rawUserId: string,
  activeOrgId: string,
  authz: MemberAuthorization,
): AuthContext {
  const ctx: AuthContext = {
    userId: userId(rawUserId),
    organizationId: organizationId(activeOrgId),
    // Custom-only members have no built-in Role; 'Staff' is a lowest-privilege placeholder —
    // effectivePermissions/scopeByPermission are authoritative (all checks route through
    // canForContext/scopeForPermission, never ctx.role directly).
    role: authz.domainRole ?? 'Staff',
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
): Promise<Readonly<{ context: AuthContext; permissionVersion: number | null }>> {
  const authorization = await resolveMemberAuthorization({
    memberRole: input.memberRole,
    activeOrgId: input.organizationId,
    userId: input.userId,
  })
  return {
    context: buildAuthContext(input.userId, input.organizationId, authorization),
    permissionVersion: authorization.permissionVersion,
  }
}

/** Resolve a durable member using the caller's transaction snapshot. */
export async function resolveMemberAuthContextWithDatabase(
  database: Database,
  input: Readonly<{
    memberRole: string
    organizationId: string
    userId: string
  }>,
): Promise<Readonly<{ context: AuthContext; permissionVersion: number | null }>> {
  const domainRole = toDomainRole(input.memberRole)
  const authorization =
    selectRoleStrategy(getEnv().ENABLE_CUSTOM_ROLES) === 'dynamic'
      ? await resolveDynamicAuthorization(
          input.memberRole,
          domainRole,
          { activeOrgId: input.organizationId, userId: input.userId },
          database,
        )
      : resolveBuiltInAuthorization(input.memberRole, domainRole)
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

  // Stage 1 — session decode before the cache lookup so the key can include the
  // active org. getSession is a JWT verify (no DB); the cache dedupes the expensive
  // getActiveMember() call + permission resolution, not the session decode.
  const session = await getAuth().api.getSession({ headers })
  if (!session) {
    throwAuthError('unauthorized', 'Valid session required')
  }
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    throwAuthError('no_active_org', 'No active organization selected')
  }

  let bindingDecision
  try {
    bindingDecision = await checkUserOrganizationBinding(session.user.id, activeOrgId)
  } catch {
    throwAuthError(
      'authorization_unavailable',
      'Organization binding could not be verified',
    )
  }
  if (bindingDecision.kind === 'deny') {
    getLogger().warn(
      { reason: bindingDecision.reason },
      'auth.organization_binding_denied: session Organization is not the beta binding',
    )
    throwAuthError(
      'organization_binding_conflict',
      'This account needs Organization access assistance',
    )
  }

  // Stage 2 — tenant-cache freshness decision table. Keyed per (session, org) so
  // an org switch A→B resolves fresh instead of serving org A's context.
  const key = tenantCacheKey(headers, activeOrgId, bindingDecision.version)
  if (key) {
    const cached = await tryServeFromCache(key)
    if (cached) {
      return cached
    }
  }

  // Stage 3 — fresh resolution: member record + role strategy.
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

  // Stage 4 — cache (only with a valid key, i.e. non-empty cookies) + memo + span.
  if (key && resolved.permissionVersion !== null) {
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
