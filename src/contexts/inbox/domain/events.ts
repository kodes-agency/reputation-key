// Inbox context — domain events
// Standards: docs/standards.md §1

import assert from 'node:assert/strict'
import type {
  InboxItemId,
  InboxNoteId,
  OrganizationId,
  PropertyId,
  UserId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'
import type { InboxStatus, SourceType } from './types'

export type InboxItemCreated = Readonly<{
  _tag: 'inbox.inbox_item.created'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  userId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemCreated = (
  args: Omit<
    InboxItemCreated,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.inboxItemId !== '', 'inboxItemId required')
  return {
    _tag: 'inbox.inbox_item.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemStatusChanged = Readonly<{
  _tag: 'inbox.inbox_item.status_changed'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  oldStatus: InboxStatus
  newStatus: InboxStatus
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemStatusChanged = (
  args: Omit<
    InboxItemStatusChanged,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemStatusChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.oldStatus !== args.newStatus,
    'Status change must transition to different status',
  )
  return {
    _tag: 'inbox.inbox_item.status_changed',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemAssigned = Readonly<{
  _tag: 'inbox.inbox_item.assigned'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  assignedTo: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemAssigned = (
  args: Omit<
    InboxItemAssigned,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemAssigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId !== '', 'userId required')
  return {
    _tag: 'inbox.inbox_item.assigned',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemUnassigned = Readonly<{
  _tag: 'inbox.inbox_item.unassigned'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  previousAssignee: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemUnassigned = (
  args: Omit<
    InboxItemUnassigned,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemUnassigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.unassigned',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemEscalated = Readonly<{
  _tag: 'inbox.inbox_item.escalated'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  oldStatus: InboxStatus
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemEscalated = (
  args: Omit<
    InboxItemEscalated,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemEscalated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.escalated',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxNoteAdded = Readonly<{
  _tag: 'inbox.inbox_note.added'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  noteId: InboxNoteId
  text: string
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxNoteAdded = (
  args: Omit<
    InboxNoteAdded,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxNoteAdded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.text.length > 0, 'note text required')
  return {
    _tag: 'inbox.inbox_note.added',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemBulkStatusChanged = Readonly<{
  _tag: 'inbox.inbox_item.bulk_status_changed'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  oldStatus: InboxStatus
  newStatus: InboxStatus
  bulkId: string
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemBulkStatusChanged = (
  args: Omit<
    InboxItemBulkStatusChanged,
    '_tag' | 'eventId' | 'correlationId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemBulkStatusChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.oldStatus !== args.newStatus,
    'Bulk status change must transition to different status',
  )
  return {
    _tag: 'inbox.inbox_item.bulk_status_changed',
    eventId: crypto.randomUUID(),
    correlationId: null,
    propertyId: args.propertyId ?? ('' as PropertyId),
    userId: args.userId ?? ('' as UserId),
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxEvent =
  | InboxItemCreated
  | InboxItemStatusChanged
  | InboxItemEscalated
  | InboxItemAssigned
  | InboxItemUnassigned
  | InboxNoteAdded
  | InboxItemBulkStatusChanged
