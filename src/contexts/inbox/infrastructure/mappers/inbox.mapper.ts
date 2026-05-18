// Inbox context — row ↔ domain mapper for inbox items
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { inboxItems } from '#/shared/db/schema/inbox.schema'
import type { InboxItem } from '../../domain/types'
import { inboxItemId, organizationId, propertyId, userId } from '#/shared/domain/ids'

type InboxItemRow = typeof inboxItems.$inferSelect
type InboxItemInsertRow = typeof inboxItems.$inferInsert

export const inboxItemFromRow = (row: InboxItemRow): InboxItem => ({
  id: inboxItemId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  sourceType: row.sourceType,
  sourceId: row.sourceId as InboxItem['sourceId'],
  status: row.status,
  rating: row.rating,
  sourceDate: row.sourceDate,
  platform: row.platform,
  snippet: row.snippet,
  assignedTo: row.assignedTo ? userId(row.assignedTo) : null,
  readAt: row.readAt,
  escalatedAt: row.escalatedAt,
  addressedAt: row.addressedAt,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const inboxItemToInsertRow = (item: Omit<InboxItem, 'createdAt' | 'updatedAt'>): InboxItemInsertRow => ({
  id: item.id as string,
  organizationId: item.organizationId as string,
  propertyId: item.propertyId as string,
  sourceType: item.sourceType,
  sourceId: item.sourceId as string,
  status: item.status,
  rating: item.rating,
  sourceDate: item.sourceDate,
  platform: item.platform,
  snippet: item.snippet,
  assignedTo: item.assignedTo as string | null,
  readAt: item.readAt,
  escalatedAt: item.escalatedAt,
  addressedAt: item.addressedAt,
  archivedAt: item.archivedAt,
})
