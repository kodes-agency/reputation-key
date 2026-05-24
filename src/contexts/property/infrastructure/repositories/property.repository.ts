// Property context — Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, inArray, isNull, not } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { properties } from '#/shared/db/schema/property.schema'
import type { PropertyRepository } from '../../application/ports/property.repository'
import { propertyFromRow, propertyToRow } from '../mappers/property.mapper'
import { propertyError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'
import type { GoogleConnectionId, PropertyId } from '#/shared/domain/ids'

/** Mutable set-values type for Drizzle .set() — strips readonly from Property fields. */
type SetValues = {
  name?: string
  slug?: string
  timezone?: string
  gbpPlaceId?: string | null
  updatedAt?: Date
  deletedAt?: Date | null
}

export const createPropertyRepository = (db: Database): PropertyRepository => ({
  findById: async (orgId, id) => {
    return trace('property.findById', async () => {
      const rows = await db
        .select()
        .from(properties)
        .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
        .limit(1)
      return rows[0] ? propertyFromRow(rows[0]) : null
    })
  },

  list: async (orgId) => {
    return trace('property.list', async () => {
      const rows = await db
        .select()
        .from(properties)
        .where(and(...baseWhere(properties, orgId)))
      return rows.map(propertyFromRow)
    })
  },

  slugExists: async (orgId, slug, excludeId) => {
    return trace('property.slugExists', async () => {
      const conditions = [...baseWhere(properties, orgId), eq(properties.slug, slug)]
      if (excludeId) {
        conditions.push(not(eq(properties.id, excludeId)))
      }

      const rows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(...conditions))
        .limit(1)
      return rows.length > 0
    })
  },

  insert: async (orgId, property) => {
    return trace('property.insert', async () => {
      // Tenant guard — the use case constructs the property with ctx.organizationId,
      // but the repo is the last line of defense against cross-tenant writes.
      if (property.organizationId !== orgId) {
        throw propertyError('forbidden', 'Tenant mismatch on property insert')
      }
      await db.insert(properties).values(propertyToRow(property))
    })
  },

  update: async (orgId, id, patch) => {
    return trace('property.update', async () => {
      const setValues: SetValues = {}
      if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt
      if (patch.name !== undefined) setValues.name = patch.name
      if (patch.slug !== undefined) setValues.slug = patch.slug
      if (patch.timezone !== undefined) setValues.timezone = patch.timezone
      if (patch.gbpPlaceId !== undefined) setValues.gbpPlaceId = patch.gbpPlaceId

      await db
        .update(properties)
        .set(setValues)
        .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
    })
  },

  hardDelete: async (orgId, id) => {
    return trace('property.hardDelete', async () => {
      await db
        .delete(properties)
        .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
    })
  },

  // Intentional cross-org lookup: GBP webhook identifies properties by placeId,
  // not orgId. The webhook handler verifies Google Pub/Sub JWT before calling this.
  // Caller is responsible for org-scoping the result.
  findByGbpPlaceId: async (gbpPlaceId) => {
    return trace('property.findByGbpPlaceId', async () => {
      const rows = await db
        .select()
        .from(properties)
        .where(and(eq(properties.gbpPlaceId, gbpPlaceId), isNull(properties.deletedAt)))
        .limit(1)
      return rows[0] ? propertyFromRow(rows[0]) : null
    })
  },

  // Public slug lookup — no orgId scoping. Slugs are unique per property
  // and used for public-facing URLs (guest portal resolution).
  findBySlug: async (slug) => {
    return trace('property.findBySlug', async () => {
      const rows = await db
        .select()
        .from(properties)
        .where(and(eq(properties.slug, slug), isNull(properties.deletedAt)))
        .limit(1)
      return rows[0] ? propertyFromRow(rows[0]) : null
    })
  },

  findIdsByGoogleConnection: async (connectionId: GoogleConnectionId, orgId) => {
    return trace('property.findIdsByGoogleConnection', async () => {
      const rows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            ...baseWhere(properties, orgId),
            eq(properties.googleConnectionId, connectionId as string),
          ),
        )
      return rows.map((r) => r.id as PropertyId)
    })
  },

  clearGoogleConnectionRef: async (orgId, propertyIds) => {
    return trace('property.clearGoogleConnectionRef', async () => {
      if (propertyIds.length === 0) return
      await db
        .update(properties)
        .set({ googleConnectionId: null })
        .where(
          and(
            ...baseWhere(properties, orgId),
            inArray(properties.id, propertyIds as readonly string[]),
          ),
        )
    })
  },

  insertAndReturn: async (orgId, property) => {
    return trace('property.insertAndReturn', async () => {
      if (property.organizationId !== orgId) {
        throw propertyError('forbidden', 'Tenant mismatch on property insert')
      }
      const [inserted] = await db
        .insert(properties)
        .values(propertyToRow(property))
        .returning()
      if (!inserted) {
        throw propertyError('property_not_found', 'Failed to retrieve inserted property')
      }
      return propertyFromRow(inserted)
    })
  },

  findExistingGbpPlaceIds: async (orgId, gbpPlaceIds) => {
    return trace('property.findExistingGbpPlaceIds', async () => {
      if (gbpPlaceIds.length === 0) return []
      const rows = await db
        .select({ gbpPlaceId: properties.gbpPlaceId })
        .from(properties)
        .where(
          and(
            ...baseWhere(properties, orgId),
            inArray(properties.gbpPlaceId, gbpPlaceIds as [string, ...string[]]),
          ),
        )
      return rows.map((r) => r.gbpPlaceId).filter((id): id is string => id !== null)
    })
  },

  existsByGbpPlaceId: async (orgId, gbpPlaceId) => {
    return trace('property.existsByGbpPlaceId', async () => {
      const rows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(...baseWhere(properties, orgId), eq(properties.gbpPlaceId, gbpPlaceId)),
        )
        .limit(1)
      return rows.length > 0
    })
  },
})
