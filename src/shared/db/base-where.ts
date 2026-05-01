// baseWhere helper — enforces tenant isolation + soft-delete filtering.
// Per architecture: "Every repository query filters by organization_id AND deleted_at IS NULL."
// Generic over any table that has organizationId and deletedAt columns,
// so every context (property, team, staff, portal, ...) reuses the same helper.
//
// Improved typing (Issue 9): The TenantTable constraint requires the table to have
// organizationId and deletedAt properties, ensuring compile-time safety when new
// tables are created. The cast to Drizzle's parameter types is still needed because
// Drizzle's PgColumn has table-specific metadata that varies per schema, but the
// structural constraint prevents passing a table that lacks these columns.

import { eq, isNull, type SQL, type Column } from 'drizzle-orm'
import type { OrganizationId } from '#/shared/domain/ids'

/**
 * Structural constraint: any Drizzle table with `organizationId` and `deletedAt` columns.
 * Requires Drizzle Column instances (not just any value) so that plain objects or
 * string properties are rejected at compile time. The `as` casts in `baseWhere` are
 * still needed because Drizzle's PgColumn carries table-specific metadata.
 */
type TenantTable = {
  organizationId: Column
  deletedAt: Column
}

/**
 * Build the base WHERE conditions for any tenant-scoped query.
 * Returns conditions that filter by organizationId AND deleted_at IS NULL.
 *
 * Usage (property context):
 *   import { properties } from '#/shared/db/schema/property.schema'
 *   db.select().from(properties).where(and(...baseWhere(properties, orgId), eq(properties.slug, slug)))
 */
export function baseWhere<T extends TenantTable>(table: T, orgId: OrganizationId): SQL[] {
  return [
    eq(
      table.organizationId as Parameters<typeof eq>[0],
      orgId as Parameters<typeof eq>[1],
    ),
    isNull(table.deletedAt as Parameters<typeof isNull>[0]),
  ]
}
