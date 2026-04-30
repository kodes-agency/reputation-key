// Portal context — link row ↔ domain mapper
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { portalLinkCategories, portalLinks } from '#/shared/db/schema/portal.schema'
import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import { organizationId, portalId, portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'

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
  id: cat.id as unknown as string,
  portalId: cat.portalId as unknown as string,
  organizationId: cat.organizationId as unknown as string,
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
  id: link.id as unknown as string,
  categoryId: link.categoryId as unknown as string,
  portalId: link.portalId as unknown as string,
  organizationId: link.organizationId as unknown as string,
  label: link.label,
  url: link.url,
  iconKey: link.iconKey,
  sortKey: link.sortKey,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
})
