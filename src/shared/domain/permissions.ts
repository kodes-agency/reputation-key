// Permission type and sync permission check — no mutable permission data.
// The permission table and its initialization live in shared/auth/permissions.ts.
// This file holds the Permission type and a can() function that delegates to
// an injected lookup, so application-layer code can import from shared/domain
// (which the boundary rules allow) without depending on better-auth.

import type { Role } from './roles'
import { domainError } from './errors'
import type { AuthContext } from './auth-context'
import type { DataScope } from './data-scope'

// ── Permission type ────────────────────────────────────────────────
// Derived from the canonical statement in shared/auth/permissions.ts.
// Must be kept in sync manually — or use the type from permissions.ts.
// Listed here explicitly so application-layer code gets autocomplete.

export type Permission =
  | 'organization.update'
  | 'organization.delete' // Reserved for future use — org deletion flow not yet implemented
  | 'member.create'
  | 'member.update'
  | 'member.delete'
  | 'member.list'
  | 'invitation.create'
  | 'invitation.list'
  | 'invitation.cancel'
  | 'invitation.resend'
  | 'property.create'
  | 'property.update'
  | 'property.delete'
  | 'property.read'
  | 'property.admin'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'team.read'
  | 'staff_assignment.create'
  | 'staff_assignment.delete'
  | 'staff_assignment.read'
  // Reserved for future use — access control context (not yet implemented)
  | 'ac.create'
  | 'ac.read'
  | 'ac.update'
  | 'ac.delete'
  | 'portal.create'
  | 'portal.update'
  | 'portal.delete'
  | 'portal.read'
  | 'review.read'
  | 'reply.manage'
  | 'inbox.read'
  | 'inbox.write'
  | 'inbox.manage'
  | 'notification.read'
  | 'notification.update'
  | 'feedback.read' // Reserved for future use — guest/feedback context not yet gated
  | 'feedback.respond' // Reserved for future use — guest/feedback context not yet gated
  | 'integration.manage'
  | 'identity.avatar_upload'
  | 'identity.logo_upload'
  | 'identity.password.change'
  | 'identity.profile.update'
  | 'identity.avatar.set'
  | 'identity.leave_org' // Reserved for future use — leave-org flow not yet permission-gated
  | 'dashboard.read'
  | 'dashboard.fleet_read'
  | 'badge.read'
  | 'badge.manage'
  | 'leaderboard.read'
  | 'goal.read'
  | 'goal.create'
  | 'goal.update'
  | 'goal.cancel'

// ── Injected permission lookup ─────────────────────────────────────
// The actual permission table lives in shared/auth/permissions.ts.
// It injects the lookup function at startup via setPermissionLookup().
// This keeps this file free of mutable permission data.

type PermissionLookup = (role: Role, permission: Permission) => boolean

let _lookup: PermissionLookup | null = null

/** Called once at startup by shared/auth/permissions.ts */
export function setPermissionLookup(lookup: PermissionLookup): void {
  _lookup = lookup
}

/** Reset the permission lookup. Test-only — use in test teardown to prevent state leaking between tests. */
export function resetPermissionLookup(): void {
  _lookup = null
}

// ── Sync permission check ─────────────────────────────────────────
// Pure, synchronous, nanosecond-cost. Used by use cases and server functions.
// Throws if the permission table hasn't been initialized.

export function can(role: Role, permission: Permission): boolean {
  if (!_lookup) {
    throw domainError(
      'permissions_not_initialized',
      'Permission table not initialized — call initPermissionTable() first',
    )
  }
  return _lookup(role, permission)
}

// ── Context-aware checks (dynamic resolver, ADR 0001) ──────────────
// Additive: prefer the dynamic fields when present, fall back to the static role
// table otherwise. Existing can(ctx.role, p) callers are unaffected; new callers
// should use these so custom/multi roles resolve correctly once the flag flips.

/** Fixed v1 scope for each built-in role (mirrors resolve-permissions BUILT_IN_ROLE_SCOPE). */
const BUILT_IN_SCOPE_FOR_ROLE: Readonly<Record<Role, DataScope>> = {
  AccountAdmin: 'organization',
  PropertyManager: 'assigned-properties',
  Staff: 'assigned-properties',
}

/**
 * Action check that prefers the dynamic effectivePermissions when present, falling
 * back to the static role table. Use this instead of can(ctx.role, p) so custom/multi
 * roles resolve correctly once the dynamic resolver is wired.
 */
export function canForContext(ctx: AuthContext, permission: Permission): boolean {
  if (ctx.effectivePermissions) return ctx.effectivePermissions.has(permission)
  return can(ctx.role, permission)
}

/**
 * Per-permission data scope. Uses the dynamic scopeByPermission map when present;
 * falls back to the built-in role's fixed scope. A permission absent from the map →
 * 'none'. Each permission's scope governs ONLY that permission's records (no widening).
 */
export function scopeForPermission(ctx: AuthContext, permission: Permission): DataScope {
  if (ctx.scopeByPermission) {
    return ctx.scopeByPermission.get(permission) ?? 'none'
  }
  return BUILT_IN_SCOPE_FOR_ROLE[ctx.role]
}
