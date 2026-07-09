// AuthContext — the caller's identity passed to every use case.
// Per architecture: "tenantMiddleware resolves org from session and attaches to AuthContext."
// Use cases receive this as their second parameter: (input, ctx) => Promise<T>
//
// Lives in shared/domain/ because it's a domain concept — "who is making this call" —
// not an auth-framework concern. The middleware that produces it lives in shared/auth/,
// but the type itself is imported by application-layer code that mustn't depend on auth.

import type { OrganizationId, UserId } from './ids'
import type { Role } from './roles'
import type { Permission } from './permissions'
import type { DataScope } from './data-scope'

/** Auth context attached to every authenticated request. */
export type AuthContext = Readonly<{
  userId: UserId
  organizationId: OrganizationId
  role: Role
  /**
   * Effective permission set from the dynamic resolver (ADR 0001). When present,
   * `canForContext` prefers it over the static `role` table so custom/multi roles
   * resolve correctly. Absent (Stage 1 fallback) → `canForContext` falls back to
   * `can(ctx.role, p)`. Populated by resolveTenantContext.
   */
  effectivePermissions?: ReadonlySet<Permission>
  /**
   * Per-permission data scope from the dynamic resolver. A permission's scope governs
   * ONLY that permission's records — no generic widening. Absent → `scopeForPermission`
   * falls back to the built-in role's fixed scope. Populated by resolveTenantContext.
   */
  scopeByPermission?: ReadonlyMap<Permission, DataScope>
}>

/**
 * JSON-serializable authorization snapshot for the client (ADR 0001 §7). Serialized from
 * AuthContext by getActiveOrganization + beforeLoad so usePermissions() can gate UI
 * affordances without a round-trip. Only granted keys appear; a missing key → 'none'.
 */
export type ClientAuthz = Readonly<{
  effectivePermissions: ReadonlyArray<Permission>
  scopeByPermission: Readonly<Partial<Record<Permission, DataScope>>>
}>

/** Empty authz — for the no-active-org / unresolved state. */
export const EMPTY_CLIENT_AUTHZ: ClientAuthz = Object.freeze({
  effectivePermissions: [],
  scopeByPermission: {},
})

/** Serialize an AuthContext's dynamic fields into the client-safe ClientAuthz shape. */
export function serializeClientAuthz(ctx: AuthContext): ClientAuthz {
  return {
    effectivePermissions: ctx.effectivePermissions ? [...ctx.effectivePermissions] : [],
    scopeByPermission: ctx.scopeByPermission
      ? Object.fromEntries(ctx.scopeByPermission)
      : {},
  }
}
