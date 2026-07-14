// Inbox context — row ↔ domain mapper for inbox items
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { inboxItems } from '#/shared/db/schema/inbox.schema'
import type { InboxItem } from '../../domain/types'
import {
  inboxItemId,
  organizationId,
  propertyId,
  userId,
  reviewId,
  feedbackId,
  unbrand,
} from '#/shared/domain/ids'

type InboxItemRow = typeof inboxItems.$inferSelect
type InboxItemInsertRow = typeof inboxItems.$inferInsert

export const inboxItemFromRow = (row: InboxItemRow): Omit<InboxItem, 'propertyName'> => ({
  id: inboxItemId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  sourceType: row.sourceType,
  sourceId:
    row.sourceType === 'review' ? reviewId(row.sourceId) : feedbackId(row.sourceId),
  status: row.status,
  isEscalated: row.isEscalated,
  escalatedAt: row.escalatedAt,
  escalatedBy: row.escalatedBy ? userId(row.escalatedBy) : null,
  escalationResolvedAt: row.escalationResolvedAt,
  escalationResolvedBy: row.escalationResolvedBy
    ? userId(row.escalationResolvedBy)
    : null,
  rating: row.rating,
  sourceDate: row.sourceDate,
  platform: row.platform,
  snippet: row.snippet,
  reviewerName: row.reviewerName,
  assignedTo: row.assignedTo ? userId(row.assignedTo) : null,
  closedAt: row.closedAt,
  firstReplySubmittedAt: row.firstReplySubmittedAt,
  firstReplyPublishedAt: row.firstReplyPublishedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const inboxItemToInsertRow = (
  item: Omit<InboxItem, 'createdAt' | 'updatedAt'>,
): InboxItemInsertRow => ({
  id: unbrand(item.id),
  organizationId: unbrand(item.organizationId),
  propertyId: unbrand(item.propertyId),
  sourceType: item.sourceType,
  sourceId: unbrand(item.sourceId),
  status: item.status,
  isEscalated: item.isEscalated,
  escalatedAt: item.escalatedAt,
  escalatedBy: item.escalatedBy ? unbrand(item.escalatedBy) : null,
  escalationResolvedAt: item.escalationResolvedAt,
  escalationResolvedBy: item.escalationResolvedBy
    ? unbrand(item.escalationResolvedBy)
    : null,
  rating: item.rating,
  sourceDate: item.sourceDate,
  platform: item.platform,
  snippet: item.snippet,
  reviewerName: item.reviewerName,
  assignedTo: item.assignedTo ? unbrand(item.assignedTo) : null,
  closedAt: item.closedAt,
  firstReplySubmittedAt: item.firstReplySubmittedAt,
  firstReplyPublishedAt: item.firstReplyPublishedAt,
})
