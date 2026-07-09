// Inbox context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
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
import { inboxError } from './errors'

export type InboxItemCreated = Readonly<{
  _tag: 'inbox.inbox_item.created'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
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
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemCreated => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  if (args.inboxItemId === '') throw inboxError('invalid_input', 'inboxItemId required')
  return {
    _tag: 'inbox.inbox_item.created',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemStatusChanged = Readonly<{
  _tag: 'inbox.inbox_item.status_changed'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
  oldStatus: InboxStatus
  newStatus: InboxStatus
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemStatusChanged = (
  args: Omit<
    InboxItemStatusChanged,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemStatusChanged => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  if (args.oldStatus === args.newStatus)
    throw inboxError(
      'invalid_transition',
      'Status change must transition to different status',
    )
  return {
    _tag: 'inbox.inbox_item.status_changed',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemAssigned = Readonly<{
  _tag: 'inbox.inbox_item.assigned'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId
  assignedTo: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemAssigned = (
  args: Omit<
    InboxItemAssigned,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemAssigned => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  if (!args.userId) throw inboxError('invalid_input', 'userId required')
  return {
    _tag: 'inbox.inbox_item.assigned',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId,
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemUnassigned = Readonly<{
  _tag: 'inbox.inbox_item.unassigned'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
  previousAssignee: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemUnassigned = (
  args: Omit<
    InboxItemUnassigned,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemUnassigned => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.unassigned',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemEscalated = Readonly<{
  _tag: 'inbox.inbox_item.escalated'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
  oldStatus: InboxStatus
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemEscalated = (
  args: Omit<
    InboxItemEscalated,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemEscalated => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.escalated',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxNoteAdded = Readonly<{
  _tag: 'inbox.inbox_note.added'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
  noteId: InboxNoteId
  text: string
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxNoteAdded = (
  args: Omit<
    InboxNoteAdded,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxNoteAdded => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  if (args.text.length === 0) throw inboxError('invalid_input', 'note text required')
  return {
    _tag: 'inbox.inbox_note.added',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    ...args,
  }
}

export type InboxItemBulkStatusChanged = Readonly<{
  _tag: 'inbox.inbox_item.bulk_status_changed'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
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
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & { userId?: UserId; source?: 'web' | 'import'; propertyId?: PropertyId },
): InboxItemBulkStatusChanged => {
  if (!(args.occurredAt instanceof Date))
    throw inboxError('invalid_input', 'occurredAt must be Date')
  if (args.oldStatus === args.newStatus)
    throw inboxError(
      'invalid_transition',
      'Bulk status change must transition to different status',
    )
  return {
    _tag: 'inbox.inbox_item.bulk_status_changed',
    eventId: newEventId(),
    correlationId: null,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
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
