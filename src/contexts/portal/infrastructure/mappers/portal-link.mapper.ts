// Portal context — link row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portalLinkCategories, portalLinks } from '#/shared/db/schema/portal.schema'
import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
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

export const linkFromRow = (row: LinkRow): PortalLink => ({
  id: portalLinkId(row.id),
  categoryId: portalLinkCategoryId(row.categoryId),
  portalId: portalId(row.portalId),
  organizationId: organizationId(row.organizationId),
  label: row.label,
  url: row.url,
  iconKey: row.iconKey,
  sortKey: row.sortKey,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const linkToRow = (link: PortalLink): LinkInsertRow => ({
  id: unbrand(link.id),
  categoryId: unbrand(link.categoryId),
  portalId: unbrand(link.portalId),
  organizationId: unbrand(link.organizationId),
  label: link.label,
  url: link.url,
  iconKey: link.iconKey,
  sortKey: link.sortKey,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
})
