// Permission type and sync permission check — no mutable permission data.
// The permission table and its initialization live in shared/auth/permissions.ts.
// This file holds the Permission type and a can() function that delegates to
// an injected lookup, so application-layer code can import from shared/domain
// (which the boundary rules allow) without depending on better-auth.

import type { Role } from './roles'

// ── Permission type ────────────────────────────────────────────────
// Derived from the canonical statement in shared/auth/permissions.ts.
// Must be kept in sync manually — or use the type from permissions.ts.
// Listed here explicitly so application-layer code gets autocomplete.

export type Permission =
  | 'organization.update'
  | 'organization.delete'
  | 'member.create'
  | 'member.update'
  | 'member.delete'
  | 'invitation.create'
  | 'invitation.cancel'
  | 'invitation.resend'
  | 'property.create'
  | 'property.update'
  | 'property.delete'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'staff_assignment.create'
  | 'staff_assignment.delete'
  | 'ac.create'
  | 'ac.read'
  | 'ac.update'
  | 'ac.delete'
  | 'portal.create'
  | 'portal.update'
  | 'portal.delete'
  | 'review.read'
  | 'review.reply'
  | 'feedback.read'
  | 'feedback.respond'
  | 'integration.manage'

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

// ── Sync permission check ─────────────────────────────────────────
// Pure, synchronous, nanosecond-cost. Used by use cases and server functions.
// Throws if the permission table hasn't been initialized.

export function can(role: Role, permission: Permission): boolean {
  if (!_lookup) {
    throw new Error('Permission table not initialized — call initPermissionTable() first')
  }
  return _lookup(role, permission)
}
