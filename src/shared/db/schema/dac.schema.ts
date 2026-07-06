// Dynamic Access Control (ADR 0001) — app-owned tables.
//
// permission_version: per-org monotonic counter bumped by Postgres triggers on
//   member / organizationRole / organization_role_policy / staff_assignments
//   mutations (the raw-SQL migration in scripts/migrations/). The resolver keys its
//   tenant-context cache on this version, so any role/assignment change — including
//   Better Auth's own writes to member/organizationRole — invalidates within one
//   request. No pub/sub needed for single-instance; the version is read per-resolve.
//
// organization_role_policy: the app-owned data_scope for a custom role. Better Auth's
//   organizationRole table holds the role name + permission statements; this table
//   holds the data_scope (organization | assigned-properties | none) the resolver
//   pairs with those permissions. (organization_id, role) is a LOGICAL join — no FK
//   to the BA tables (per §2 of the plan: two migrators can't share FK ownership).
//   Consistency is enforced by the app-owned service writing both rows in one txn and
//   by the §2 preflight (orphan / BA-without-policy checks).

import { sql } from 'drizzle-orm'
import { pgTable, text, bigint, uuid, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

export const permissionVersion = pgTable('permission_version', {
  organizationId: text('organization_id').primaryKey(),
  version: bigint('version', { mode: 'number' }).notNull().default(0),
  updatedAt: updatedAtColumn(),
})

export const organizationRolePolicy = pgTable(
  'organization_role_policy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    role: text('role').notNull(),
    dataScope: text('data_scope').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    // One policy per (org, role). Mirrors the case-insensitive unique index on BA's
    // organizationRole — role names are canonicalized (lowercase/trim) before insert,
    // so the plain text comparison here matches the lower(role) index over there.
    orgRoleUnique: uniqueIndex('organization_role_policy_org_role_unique').on(
      t.organizationId,
      t.role,
    ),
    dataScopeCheck: check(
      'organization_role_policy_data_scope_check',
      sql`${t.dataScope} IN ('organization', 'assigned-properties', 'none')`,
    ),
    // min 3 / max 64 chars; lowercase start; lowercase-or-digit end; middle allows hyphens.
    roleFormatCheck: check(
      'organization_role_policy_role_format_check',
      sql`${t.role} ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'`,
    ),
    roleNoCommaCheck: check(
      'organization_role_policy_role_no_comma_check',
      sql`position(',' in ${t.role}) = 0`,
    ),
    // Custom roles may not shadow the built-in names — those are reserved for BA.
    roleNotReservedCheck: check(
      'organization_role_policy_role_not_reserved_check',
      sql`${t.role} NOT IN ('owner', 'admin', 'member')`,
    ),
  }),
)
