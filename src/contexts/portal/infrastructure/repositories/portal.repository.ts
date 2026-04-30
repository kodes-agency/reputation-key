// Portal context — Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, not } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portals } from '#/shared/db/schema/portal.schema'
import type { PortalRepository } from '../../application/ports/portal.repository'
import { portalFromRow, portalToRow } from '../mappers/portal.mapper'
import { portalError } from '../../domain/errors'

/** Mutable set-values type for Drizzle .set() — strips readonly from Portal fields. */
type SetValues = {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  theme?: Record<string, unknown>
  smartRoutingEnabled?: boolean
  smartRoutingThreshold?: number
  isActive?: boolean
  updatedAt?: Date
  deletedAt?: Date | null
}

export const createPortalRepository = (db: Database): PortalRepository => ({
  findById: async (orgId, id) => {
    const rows = await db
      .select()
      .from(portals)
      .where(and(...baseWhere(portals, orgId), eq(portals.id, id as unknown as string)))
      .limit(1)
    return rows[0] ? portalFromRow(rows[0]) : null
  },

  findBySlug: async (orgId, slug) => {
    const rows = await db
      .select()
      .from(portals)
      .where(and(...baseWhere(portals, orgId), eq(portals.slug, slug)))
      .limit(1)
    return rows[0] ? portalFromRow(rows[0]) : null
  },

  list: async (orgId) => {
    const rows = await db
      .select()
      .from(portals)
      .where(and(...baseWhere(portals, orgId)))
    return rows.map(portalFromRow)
  },

  listByProperty: async (orgId, propertyId) => {
    const rows = await db
      .select()
      .from(portals)
      .where(and(...baseWhere(portals, orgId), eq(portals.propertyId, propertyId)))
    return rows.map(portalFromRow)
  },

  slugExists: async (orgId, slug, excludeId) => {
    const conditions = [...baseWhere(portals, orgId), eq(portals.slug, slug)]
    if (excludeId) {
      conditions.push(not(eq(portals.id, excludeId as unknown as string)))
    }
    const rows = await db
      .select({ id: portals.id })
      .from(portals)
      .where(and(...conditions))
      .limit(1)
    return rows.length > 0
  },

  insert: async (orgId, portal) => {
    if (portal.organizationId !== orgId) {
      throw portalError('forbidden', 'Tenant mismatch on portal insert')
    }
    await db.insert(portals).values(portalToRow(portal))
  },

  update: async (orgId, id, patch) => {
    const setValues: SetValues = {}
    if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt
    if (patch.name !== undefined) setValues.name = patch.name
    if (patch.slug !== undefined) setValues.slug = patch.slug
    if (patch.description !== undefined) setValues.description = patch.description
    if (patch.heroImageUrl !== undefined) setValues.heroImageUrl = patch.heroImageUrl
    if (patch.theme !== undefined)
      setValues.theme = patch.theme as Record<string, unknown>
    if (patch.smartRoutingEnabled !== undefined)
      setValues.smartRoutingEnabled = patch.smartRoutingEnabled
    if (patch.smartRoutingThreshold !== undefined)
      setValues.smartRoutingThreshold = patch.smartRoutingThreshold
    if (patch.isActive !== undefined) setValues.isActive = patch.isActive

    await db
      .update(portals)
      .set(setValues)
      .where(and(...baseWhere(portals, orgId), eq(portals.id, id as unknown as string)))
  },

  softDelete: async (orgId, id) => {
    const now = new Date()
    await db
      .update(portals)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(...baseWhere(portals, orgId), eq(portals.id, id as unknown as string)))
  },
})
