// Sync permission check — pure function, no framework dependencies.
// Used by use cases (application layer) and server functions.
//
// The permission data (which role has which actions) is defined in
// shared/auth/permissions.ts using better-auth's createAccessControl.
// This file holds only the pure lookup function and the Permission type,
// so application-layer code can import it without depending on better-auth.
//
// The permission table is injected at startup via setPermissionTable(),
// called from shared/auth/permissions.ts which owns the AC definitions.

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

// ── Permission table (injected from shared/auth/permissions.ts) ────

type PermissionTable = Record<Role, ReadonlySet<string>>

let _table: PermissionTable | null = null

/** Called once at startup by shared/auth/permissions.ts */
export function setPermissionTable(table: PermissionTable): void {
  _table = table
}

// ── Sync permission check ─────────────────────────────────────────
// Pure, synchronous, nanosecond-cost. Used by use cases and server functions.
// Returns false if the permission table hasn't been initialized (shouldn't happen in practice).

export function can(role: Role, permission: Permission): boolean {
  if (!_table) return false
  return _table[role]?.has(permission) ?? false
}
