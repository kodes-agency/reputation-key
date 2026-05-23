// Shared permission definitions — single source of truth for all authorization.
// Defines the permission statement (all resources × actions), three default roles
// using better-auth's createAccessControl, and initializes the sync permission table
// used by shared/domain/permissions.ts can().
//
// The `ac` and role objects are passed to the `organization()` server plugin
// and `organizationClient()` client plugin for Phase B (dynamic roles) compatibility.
//
// Tenant isolation (org-level data scoping) is orthogonal to this system.
// Repositories enforce organization_id filtering via baseWhere(). This file
// only controls what actions a role can perform within its own organization.

import { createAccessControl } from 'better-auth/plugins/access'
import { setPermissionLookup } from '#/shared/domain/permissions'
import type { Role } from '#/shared/domain/roles'

// ── Permission statement ──────────────────────────────────────────
// Defines the universe of all resources and actions in the application.
// Adding a new resource or action requires a code deploy.

export const statement = {
  organization: ['update', 'delete'],
  member: ['create', 'list', 'update', 'delete'],
  dashboard: ['read'],
  invitation: ['create', 'list', 'cancel', 'resend'],
  property: ['create', 'update', 'delete'],
  team: ['create', 'update', 'delete'],
  staff_assignment: ['create', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
  portal: ['create', 'update', 'delete'],
  review: ['read', 'reply'],
  reply: ['manage'],
  feedback: ['read', 'respond'],
  inbox: ['read', 'update'],
  integration: ['manage'],
  goal: ['read', 'write'],
} as const

export const ac = createAccessControl(statement)

// ── Default roles ──────────────────────────────────────────────────
// Three roles matching better-auth's organization plugin defaults.
// owner = AccountAdmin, admin = PropertyManager, member = Staff.

export const owner = ac.newRole(statement)

export const admin = ac.newRole({
  member: ['create', 'list'],
  dashboard: ['read'],
  invitation: ['create', 'list', 'cancel', 'resend'],
  property: ['create', 'update'],
  team: ['create', 'update'],
  staff_assignment: ['create', 'delete'],
  portal: ['create', 'update'],
  review: ['read', 'reply'],
  reply: ['manage'],
  feedback: ['read', 'respond'],
  inbox: ['read', 'update'],
  organization: ['update'],
  goal: ['read', 'write'],
  integration: ['manage'],
})

export const memberRole = ac.newRole({
  review: ['read'],
  dashboard: ['read'],
  inbox: ['read', 'update'],
  goal: ['read'],
})

// ── Build and inject the permission table ──────────────────────────
// Converts the role objects' .statements into Sets for O(1) lookup.
// Called at module load time — runs once when the auth module is first imported.

function buildPermissionSet(
  roleStatements: Record<string, readonly string[]>,
): ReadonlySet<string> {
  const entries: string[] = []
  for (const [resource, actions] of Object.entries(roleStatements)) {
    for (const action of actions) {
      entries.push(`${resource}.${action}`)
    }
  }
  return new Set(entries)
}

// ── Mutable permission table ───────────────────────────────────────
// Initialized once at startup. Lives here (not in shared/domain)
// because shared/domain must be pure — no mutable permission data.

type PermissionTable = Record<Role, ReadonlySet<string>>

let _table: PermissionTable | null = null

/** Build and set the permission table from the role definitions above. */
export function initPermissionTable(): void {
  _table = {
    AccountAdmin: buildPermissionSet(
      owner.statements as Record<string, readonly string[]>,
    ),
    PropertyManager: buildPermissionSet(
      admin.statements as Record<string, readonly string[]>,
    ),
    Staff: buildPermissionSet(memberRole.statements as Record<string, readonly string[]>),
  }

  // Inject the lookup into shared/domain so application-layer code
  // can import can() from shared/domain/permissions (boundary-compliant).
  setPermissionLookup((role, permission) => {
    return _table![role]?.has(permission) ?? false
  })
}

// ── Re-export for test convenience ─────────────────────────────────
// The canonical `can` lives in shared/domain/permissions.ts.
// Re-exported here so internal tests can import from './permissions'.
export { can } from '#/shared/domain/permissions'

// ── Auto-initialize on import ──────────────────────────────────────
// This runs once when the auth module is first imported (during bootstrap).
// It is safe because: (1) getEnv() is called before this module is imported,
// (2) the role definitions above are pure and don't depend on runtime state,
// (3) tests that need to reset the table can call initPermissionTable() again.
// Do NOT move this into a bootstrap() call — every importer would need to
// remember to call it, and the current pattern works reliably in practice.
initPermissionTable()
