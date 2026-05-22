// Integration context — property repository adapter for import use case
// Implements the PropertyImportRepo port defined in the application layer.
// Direct DB access via Drizzle for property creation during GBP import.

import type { PropertyImportRepo } from '../../application/ports/property-import-repo.port'
import { duplicateKeyError } from '../../application/ports/property-import-repo.port'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'

export const createPropertyImportRepository = (db: Database): PropertyImportRepo => ({
  insertProperty: async (input) => {
    return trace('propertyImport.insertProperty', async () => {
      const now = new Date()
      try {
        const [inserted] = await db
          .insert(properties)
          .values({
            organizationId: input.organizationId,
            name: input.name,
            slug: input.slug,
            timezone: 'UTC',
            gbpPlaceId: input.gbpPlaceId,
            googleConnectionId: input.googleConnectionId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()

        return {
          id: inserted.id,
          organizationId: inserted.organizationId,
          name: inserted.name,
          slug: inserted.slug,
          gbpPlaceId: inserted.gbpPlaceId,
          createdAt: inserted.createdAt,
        }
      } catch (err) {
        const isPg23505 =
          err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'
        if (isPg23505) {
          throw duplicateKeyError(
            `Duplicate property for gbpPlaceId=${input.gbpPlaceId}`,
          )
        }
        throw err
      }
    })
  },

  findExistingGbpPlaceIds: async (organizationId, gbpPlaceIds) => {
    return trace('propertyImport.findExistingGbpPlaceIds', async () => {
      if (gbpPlaceIds.length === 0) return []

      const rows = await db
        .select({ gbpPlaceId: properties.gbpPlaceId })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationId),
            isNull(properties.deletedAt),
            inArray(properties.gbpPlaceId, gbpPlaceIds as [string, ...string[]]),
          ),
        )

      return rows
        .map((r) => r.gbpPlaceId)
        .filter((id): id is string => id !== null)
    })
  },

  existsByGbpPlaceId: async (organizationId, gbpPlaceId) => {
    return trace('propertyImport.existsByGbpPlaceId', async () => {
      const rows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, organizationId),
            eq(properties.gbpPlaceId, gbpPlaceId),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1)

      return rows.length > 0
    })
  },
})
