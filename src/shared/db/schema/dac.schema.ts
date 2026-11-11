// Dynamic Access Control (ADR 0001) — app-owned tables.
//
// permission_version: per-org monotonic counter bumped by Postgres triggers on
//   member / property_access_grant mutations (installed by the DB-constructs
//   journal). The resolver keys its tenant-context cache on this version, so any
//   role/assignment/grant change — including Better Auth's own writes to
//   member — invalidates within one request. Protected delayed
//   commands also lock this row while revalidating their named actor.
//

import { pgTable, text, bigint } from 'drizzle-orm/pg-core'
import { updatedAtColumn } from '../columns'

export const permissionVersion = pgTable('permission_version', {
  organizationId: text('organization_id').primaryKey(),
  version: bigint('version', { mode: 'number' }).notNull().default(0),
  updatedAt: updatedAtColumn(),
})
