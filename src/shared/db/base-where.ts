// baseWhere helper — enforces tenant isolation + soft-delete filtering.
// Per architecture: "Every repository query filters by organization_id AND deleted_at IS NULL."
// Generic over any table that has organizationId and deletedAt columns,
// so every context (property, team, staff, portal, ...) reuses the same helper.

import { eq, isNull, type SQL } from 'drizzle-orm'
import type { OrganizationId } from '#/shared/domain/ids'

/**
 * Any Drizzle table that has an `organizationId` column and a nullable `deletedAt` column.
 * Used to constrain the generic so TypeScript catches missing columns at compile time.
 */
type TenantTable = {
  organizationId: unknown
  deletedAt: unknown
}

/**
 * Build the base WHERE conditions for any tenant-scoped query.
 * Returns conditions that filter by organizationId AND deleted_at IS NULL.
 *
 * Usage (property context):
 *   import { properties } from '#/shared/db/schema/property.schema'
 *   db.select().from(properties).where(and(...baseWhere(properties, orgId), eq(properties.slug, slug)))
 *
 * Usage (team context, Phase 6+):
 *   import { teams } from '#/shared/db/schema/team.schema'
 *   db.select().from(teams).where(and(...baseWhere(teams, orgId)))
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
