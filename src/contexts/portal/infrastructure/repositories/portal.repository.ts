// Portal context — Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, asc, eq, ne, not, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { portals } from '#/shared/db/schema/portal.schema'
import type {
  PortalRepository,
  ResolvePortalContextResult,
} from '../../application/ports/portal.repository'
import { portalFromRow } from '../mappers/portal.mapper'
import {
  portalId as toPortalId,
  unbrand,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createPortalRepository = (db: Database): PortalRepository => ({
  findById: async (orgId, id) => {
    return trace('portal.findById', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.id, unbrand(id))))
        .limit(1)
      return rows[0] ? portalFromRow(rows[0]) : null
    })
  },

  findBySlug: async (orgId, slug) => {
    return trace('portal.findBySlug', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.slug, slug)))
        .limit(1)
      return rows[0] ? portalFromRow(rows[0]) : null
    })
  },

  list: async (orgId) => {
    return trace('portal.list', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId)))
      return rows.map(portalFromRow)
    })
  },

  listByProperty: async (orgId, propertyId) => {
    return trace('portal.listByProperty', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.propertyId, propertyId)))
      return rows.map(portalFromRow)
    })
  },

  slugExists: async (orgId, propertyId, slug, excludeId) => {
    return trace('portal.slugExists', async () => {
      const conditions = [
        ...baseWhere(portals, orgId),
        eq(portals.propertyId, propertyId),
        eq(portals.slug, slug),
      ]
      if (excludeId) {
        conditions.push(not(eq(portals.id, unbrand(excludeId))))
      }
      const rows = await db
        .select({ id: portals.id })
        .from(portals)
        .where(and(...conditions))
        .limit(1)
      return rows.length > 0
    })
  },

  resolvePortalContext: async (portalIdParam) => {
    return trace('portal.resolvePortalContext', async () => {
      const rows = await db
        .select({
          organizationId: portals.organizationId,
          propertyId: portals.propertyId,
        })
        .from(portals)
        .where(and(eq(portals.id, unbrand(portalIdParam)), isNull(portals.deletedAt)))
        .limit(1)

      if (rows.length === 0) return null

      return {
        organizationId: rows[0].organizationId as OrganizationId,
        propertyId: rows[0].propertyId as PropertyId,
      } satisfies ResolvePortalContextResult
    })
  },
})

/** A deterministic, database-bounded snapshot for explicit Goal assignment. */
export const createCurrentPortalIdReader =
  (db: Database) =>
  async (
    orgId: OrganizationId,
    propertyId: PropertyId,
    limit: number,
  ): Promise<ReadonlyArray<PortalId>> => {
    if (!Number.isInteger(limit) || limit < 1) return []
    const rows = await db
      .select({ id: portals.id })
      .from(portals)
      .where(
        and(
          ...baseWhere(portals, orgId),
          eq(portals.propertyId, propertyId),
          ne(portals.publicationState, 'archived'),
        ),
      )
      .orderBy(asc(portals.id))
      .limit(limit)
    return rows.map((row) => toPortalId(row.id))
  }
