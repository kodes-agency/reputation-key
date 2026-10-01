// Portal context — portal link Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id (tenant isolation).

import { eq, and, inArray, isNull, type SQL } from 'drizzle-orm'
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
  categoryToRow,
  linkFromRow,
  linkTextFromRow,
  linkToRow,
} from '../mappers/portal-link.mapper'
import { portalError } from '../../domain/errors'
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

export const createPortalLinkRepository = (
  db: Database,
  clock: () => Date,
): PortalLinkRepository => ({
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
        .select({
          id: portalLinks.id,
          label: portalLinks.label,
          updatedAt: portalLinks.updatedAt,
        })
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

  insertCategory: async (orgId, cat) => {
    return trace('portalLink.insertCategory', async () => {
      if (cat.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on category insert')
      }
      await db.insert(portalLinkCategories).values(categoryToRow(cat))
    })
  },

  insertLink: async (orgId, link) => {
    return trace('portalLink.insertLink', async () => {
      if (link.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on link insert')
      }
      await db.insert(portalLinks).values(linkToRow(link))
    })
  },

  updateLink: async (orgId, portalId, id, patch) => {
    return trace('portalLink.updateLink', async () => {
      const setValues: Partial<typeof portalLinks.$inferInsert> = {}
      if (patch.label !== undefined) setValues.label = patch.label
      if (patch.destinationId !== undefined) {
        setValues.destinationId = patch.destinationId
          ? unbrand(patch.destinationId)
          : null
        setValues.url = patch.destinationId ? null : patch.url
      } else if (patch.url !== undefined) {
        setValues.url = patch.url
      }
      if (patch.legacyDestinationState !== undefined) {
        setValues.legacyDestinationState = patch.legacyDestinationState
      }
      if (patch.iconKey !== undefined) setValues.iconKey = patch.iconKey
      if (patch.imageAssetId !== undefined) {
        setValues.imageAssetId = patch.imageAssetId ? unbrand(patch.imageAssetId) : null
      }
      if (patch.sortKey !== undefined) setValues.sortKey = patch.sortKey
      if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt

      await db
        .update(portalLinks)
        .set(setValues)
        .where(and(linkOrg(orgId), linkPortal(portalId), linkIdEq(id)))
    })
  },

  deleteLink: async (orgId, portalId, id) => {
    return trace('portalLink.deleteLink', async () => {
      await db
        .delete(portalLinks)
        .where(and(linkOrg(orgId), linkPortal(portalId), linkIdEq(id)))
    })
  },

  reorderLinks: async (orgId, portalId, categoryId, updates) => {
    return trace('portalLink.reorderLinks', async () => {
      const updatedAt = clock()
      await db.transaction(async (tx) => {
        const ids = updates.map(({ id }) => unbrand(id))
        if (ids.length > 0) {
          const scoped = await tx
            .select({ id: portalLinks.id })
            .from(portalLinks)
            .where(
              and(
                linkOrg(orgId),
                linkPortal(portalId),
                linkCat(categoryId),
                inArray(portalLinks.id, ids),
              ),
            )
          if (scoped.length !== ids.length) {
            throw portalError('forbidden', 'Portal link scope mismatch')
          }
        }
        for (const { id, sortKey } of updates) {
          await tx
            .update(portalLinks)
            .set({ sortKey, updatedAt })
            .where(
              and(
                linkOrg(orgId),
                linkPortal(portalId),
                linkCat(categoryId),
                linkIdEq(id),
              ),
            )
        }
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

  findLinkById: async (orgId, id) => {
    return trace('portalLink.findLinkById', async () => {
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
        .where(and(linkOrg(orgId), linkIdEq(id)))
        .limit(1)
      return rows[0] ? linkFromRow(rows[0].link, rows[0].destinationUri) : null
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
