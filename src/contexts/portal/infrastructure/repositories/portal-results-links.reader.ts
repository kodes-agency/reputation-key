import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portals,
  portalLinks,
  portalLinkCategories,
} from '#/shared/db/schema/portal.schema'
import { portalLinkTexts } from '#/shared/db/schema/portal-localization.schema'
import type { PortalPublicApi } from '../../application/public-api'

/** Current links in guest order, labelled in the Portal’s primary language. */
export const createPortalResultsLinksReader =
  (db: Database): PortalPublicApi['listResultsLinks'] =>
  async (organizationId, propertyId, portalId) => {
    const [portal] = await db
      .select({ enabled: portals.linktreeEnabled })
      .from(portals)
      .where(
        and(
          eq(portals.organizationId, organizationId),
          eq(portals.propertyId, propertyId),
          eq(portals.id, portalId),
          isNull(portals.deletedAt),
        ),
      )
    if (!portal) return { enabled: false, rows: [] }
    const rows = await db
      .select({
        linkId: portalLinks.id,
        label: portalLinkTexts.label,
        legacyLabel: portalLinks.label,
        iconKey: portalLinks.iconKey,
      })
      .from(portalLinks)
      .innerJoin(
        portals,
        and(
          eq(portals.id, portalLinks.portalId),
          eq(portals.organizationId, portalLinks.organizationId),
        ),
      )
      .innerJoin(
        portalLinkCategories,
        and(
          eq(portalLinkCategories.id, portalLinks.categoryId),
          eq(portalLinkCategories.organizationId, portalLinks.organizationId),
        ),
      )
      .leftJoin(
        portalLinkTexts,
        and(
          eq(portalLinkTexts.linkId, portalLinks.id),
          eq(portalLinkTexts.organizationId, organizationId),
          eq(portalLinkTexts.locale, portals.primaryGuestLocale),
        ),
      )
      .where(
        and(
          eq(portalLinks.organizationId, organizationId),
          eq(portalLinks.propertyId, propertyId),
          eq(portalLinks.portalId, portalId),
          isNull(portals.deletedAt),
        ),
      )
      .orderBy(portalLinkCategories.sortKey, portalLinks.sortKey, portalLinks.id)
    return {
      enabled: portal.enabled,
      rows: rows.map((row) => ({
        linkId: row.linkId,
        label: row.label ?? row.legacyLabel,
        iconKey: row.iconKey,
      })),
    }
  }
