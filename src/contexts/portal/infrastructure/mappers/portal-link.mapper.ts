// Portal context — link row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portalLinkCategories, portalLinks } from '#/shared/db/schema/portal.schema'
import type { portalLinkTexts } from '#/shared/db/schema/portal-localization.schema'
import { parseGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import type {
  PortalLinkTextProvenance,
  StoredPortalLinkText,
} from '../../domain/portal-linktree'
import {
  organizationId,
  propertyId,
  portalApprovedDestinationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  portalMediaAssetId,
  unbrand,
} from '#/shared/domain/ids'

// ── Category mapper ────────────────────────────────────────────────

type CategoryRow = typeof portalLinkCategories.$inferSelect
type CategoryInsertRow = typeof portalLinkCategories.$inferInsert

export const categoryFromRow = (row: CategoryRow): PortalLinkCategory => ({
  id: portalLinkCategoryId(row.id),
  portalId: portalId(row.portalId),
  organizationId: organizationId(row.organizationId),
  title: row.title,
  sortKey: row.sortKey,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const categoryToRow = (cat: PortalLinkCategory): CategoryInsertRow => ({
  id: unbrand(cat.id),
  portalId: unbrand(cat.portalId),
  organizationId: unbrand(cat.organizationId),
  title: cat.title,
  sortKey: cat.sortKey,
  createdAt: cat.createdAt,
  updatedAt: cat.updatedAt,
})

// ── Link mapper ────────────────────────────────────────────────────

type LinkRow = typeof portalLinks.$inferSelect
type LinkInsertRow = typeof portalLinks.$inferInsert

export const linkFromRow = (row: LinkRow, resolvedUrl?: string | null): PortalLink => {
  const url = resolvedUrl ?? row.url
  if (!url) throw new Error('Portal link has no governed or legacy destination')
  return {
    id: portalLinkId(row.id),
    categoryId: portalLinkCategoryId(row.categoryId),
    portalId: portalId(row.portalId),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    destinationId: row.destinationId
      ? portalApprovedDestinationId(row.destinationId)
      : null,
    legacyDestinationState:
      row.legacyDestinationState as PortalLink['legacyDestinationState'],
    label: row.label,
    url,
    iconKey: row.iconKey,
    imageAssetId: row.imageAssetId ? portalMediaAssetId(row.imageAssetId) : null,
    sortKey: row.sortKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const linkToRow = (link: PortalLink): LinkInsertRow => ({
  id: unbrand(link.id),
  categoryId: unbrand(link.categoryId),
  portalId: unbrand(link.portalId),
  organizationId: unbrand(link.organizationId),
  propertyId: unbrand(link.propertyId),
  destinationId: link.destinationId ? unbrand(link.destinationId) : null,
  legacyDestinationState: link.destinationId ? 'migrated' : link.legacyDestinationState,
  label: link.label,
  url: link.destinationId ? null : link.url,
  iconKey: link.iconKey,
  imageAssetId: link.imageAssetId ? unbrand(link.imageAssetId) : null,
  sortKey: link.sortKey,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
})

/**
 * The row of a link being written today. The legacy `label` column is no longer
 * written (a link's wording is its `portal_link_texts` rows), so it holds the
 * empty string the NOT NULL column needs until it is dropped. `linkToRow` stays
 * the faithful mapping, for fixtures that stand for links older than this.
 */
export const newLinkToRow = (link: PortalLink): LinkInsertRow => ({
  ...linkToRow(link),
  label: '',
})

// ── Link text mapper ───────────────────────────────────────────────

type LinkTextRow = typeof portalLinkTexts.$inferSelect

function provenanceFromRow(value: string | null): PortalLinkTextProvenance | null {
  if (value === null) return null
  if (value === 'ai_draft') return value
  throw new Error(`Portal link text has an unknown provenance: ${value}`)
}

/** A stored locale outside the catalogue is a corrupt row, never a quiet English. */
export const linkTextFromRow = (row: LinkTextRow): StoredPortalLinkText => {
  const locale = parseGuestLocale(row.locale)
  if (!locale) {
    throw new Error(`Portal link text has an unknown guest locale: ${row.locale}`)
  }
  return {
    linkId: row.linkId,
    locale,
    label: row.label,
    line: row.line,
    provenance: provenanceFromRow(row.provenance),
    version: row.version,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  }
}
