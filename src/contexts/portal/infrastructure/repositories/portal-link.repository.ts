// Portal context — portal link Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id (tenant isolation).

import { eq, and, isNull, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLinkCategories,
  portalLinks,
  portalApprovedDestinations,
  portals,
} from '#/shared/db/schema/portal.schema'
import { portalLinkTexts } from '#/shared/db/schema/portal-localization.schema'
import { resolveLinkTexts } from '../../domain/portal-linktree'
import type { PortalLinkRepository } from '../../application/ports/portal-link.repository'
import type {
  OrganizationId,
  PortalId,
  PortalLinkCategoryId,
  PortalLinkId,
} from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'
import {
  categoryFromRow,
  linkFromRow,
  linkTextFromRow,
} from '../mappers/portal-link.mapper'
import { trace } from '#/shared/observability/trace'

// ── Tenant-filter helpers ─────────────────────────────────────────

const catOrg = (orgId: OrganizationId): SQL<unknown> =>
  eq(portalLinkCategories.organizationId, unbrand(orgId))

const catIdEq = (id: PortalLinkCategoryId): SQL<unknown> =>
  eq(portalLinkCategories.id, unbrand(id))

const catPortal = (portalId: PortalId): SQL<unknown> =>
  eq(portalLinkCategories.portalId, unbrand(portalId))

const linkOrg = (orgId: OrganizationId): SQL<unknown> =>
  eq(portalLinks.organizationId, unbrand(orgId))

const linkIdEq = (id: PortalLinkId): SQL<unknown> => eq(portalLinks.id, unbrand(id))

const linkCat = (categoryId: PortalLinkCategoryId): SQL<unknown> =>
  eq(portalLinks.categoryId, unbrand(categoryId))

const linkPortal = (portalId: PortalId): SQL<unknown> =>
  eq(portalLinks.portalId, unbrand(portalId))

export const createPortalLinkRepository = (db: Database): PortalLinkRepository => ({
  listCategories: async (orgId, portalId) => {
    return trace('portalLink.listCategories', async () => {
      const rows = await db
        .select()
        .from(portalLinkCategories)
        .where(and(catOrg(orgId), catPortal(portalId)))
        .orderBy(portalLinkCategories.sortKey)
      return rows.map(categoryFromRow)
    })
  },

  listLinks: async (orgId, portalId, categoryId) => {
    return trace('portalLink.listLinks', async () => {
      const rows = await db
        .select({
          link: portalLinks,
          destinationUri: portalApprovedDestinations.normalizedUri,
        })
        .from(portalLinks)
        .leftJoin(
          portalApprovedDestinations,
          and(
            eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
            eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
            eq(portalApprovedDestinations.id, portalLinks.destinationId),
          ),
        )
        .where(and(linkOrg(orgId), linkPortal(portalId), linkCat(categoryId)))
        .orderBy(portalLinks.sortKey)
      return rows.map((row) => linkFromRow(row.link, row.destinationUri))
    })
  },

  listAllLinks: async (orgId, portalId) => {
    return trace('portalLink.listAllLinks', async () => {
      const rows = await db
        .select({
          link: portalLinks,
          destinationUri: portalApprovedDestinations.normalizedUri,
        })
        .from(portalLinks)
        .leftJoin(
          portalApprovedDestinations,
          and(
            eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
            eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
            eq(portalApprovedDestinations.id, portalLinks.destinationId),
          ),
        )
        .where(and(linkOrg(orgId), linkPortal(portalId)))
        .orderBy(portalLinks.sortKey)
      return rows.map((row) => linkFromRow(row.link, row.destinationUri))
    })
  },

  listLinkTexts: async (orgId, portalId, primaryLocale) => {
    return trace('portalLink.listLinkTexts', async () => {
      const links = await db
        .select({ id: portalLinks.id, label: portalLinks.label })
        .from(portalLinks)
        .innerJoin(
          portalLinkCategories,
          and(
            eq(portalLinkCategories.organizationId, portalLinks.organizationId),
            eq(portalLinkCategories.id, portalLinks.categoryId),
          ),
        )
        .where(and(linkOrg(orgId), linkPortal(portalId)))
        .orderBy(portalLinkCategories.sortKey, portalLinks.sortKey, portalLinks.id)
      const texts = await db
        .select()
        .from(portalLinkTexts)
        .where(
          and(
            eq(portalLinkTexts.organizationId, unbrand(orgId)),
            eq(portalLinkTexts.portalId, unbrand(portalId)),
          ),
        )
      return resolveLinkTexts({
        links,
        texts: texts.map(linkTextFromRow),
        primaryLocale,
      })
    })
  },

  findCategoryById: async (orgId, id) => {
    return trace('portalLink.findCategoryById', async () => {
      const rows = await db
        .select()
        .from(portalLinkCategories)
        .where(and(catOrg(orgId), catIdEq(id)))
        .limit(1)
      return rows[0] ? categoryFromRow(rows[0]) : null
    })
  },

  findLinkCommandTarget: async (orgId, id) => {
    return trace('portalLink.findLinkCommandTarget', async () => {
      const [row] = await db
        .select({
          link: portalLinks,
          destinationUri: portalApprovedDestinations.normalizedUri,
          portalUpdatedAt: portals.updatedAt,
        })
        .from(portalLinks)
        .innerJoin(
          portals,
          and(
            eq(portals.organizationId, portalLinks.organizationId),
            eq(portals.id, portalLinks.portalId),
            isNull(portals.deletedAt),
          ),
        )
        .leftJoin(
          portalApprovedDestinations,
          and(
            eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
            eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
            eq(portalApprovedDestinations.id, portalLinks.destinationId),
          ),
        )
        .where(and(linkOrg(orgId), linkIdEq(id)))
        .limit(1)
      return row
        ? {
            link: linkFromRow(row.link, row.destinationUri),
            portalUpdatedAt: row.portalUpdatedAt,
          }
        : null
    })
  },
})
