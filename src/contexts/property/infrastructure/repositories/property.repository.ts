// Property context — Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, not } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { properties } from '#/shared/db/schema/property.schema'
import type { PropertyRepository } from '../../application/ports/property.repository'
import { propertyFromRow, propertyToRow } from '../mappers/property.mapper'
import { propertyError } from '../../domain/errors'

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
    const rows = await db
      .select()
      .from(properties)
      .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
      .limit(1)
    return rows[0] ? propertyFromRow(rows[0]) : null
  },

  list: async (orgId) => {
    const rows = await db
      .select()
      .from(properties)
      .where(and(...baseWhere(properties, orgId)))
    return rows.map(propertyFromRow)
  },

  slugExists: async (orgId, slug, excludeId) => {
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
  },

  insert: async (orgId, property) => {
    // Tenant guard — the use case constructs the property with ctx.organizationId,
    // but the repo is the last line of defense against cross-tenant writes.
    if (property.organizationId !== orgId) {
      throw propertyError('forbidden', 'Tenant mismatch on property insert')
    }
    await db.insert(properties).values(propertyToRow(property))
  },

  update: async (orgId, id, patch) => {
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
  },

  softDelete: async (orgId, id) => {
    // Use the current timestamp for the soft-delete marker.
    // The use case emits the domain event with its own clock-derived timestamp.
    const now = new Date()
    await db
      .update(properties)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
  },
})
