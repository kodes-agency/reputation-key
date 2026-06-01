// Inbox context — domain events
// Per architecture: "Events are facts, named in the past tense."

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

// fallow-ignore-next-line unused-type
export type InboxItemCreated = Readonly<{
  _tag: 'inbox.item.created'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InboxStatusChanged = Readonly<{
  _tag: 'inbox.status.changed'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  oldStatus: InboxStatus
  newStatus: InboxStatus
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InboxItemAssigned = Readonly<{
  _tag: 'inbox.item.assigned'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  assignedTo: UserId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InboxNoteAdded = Readonly<{
  _tag: 'inbox.note.added'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  authorUserId: UserId
  noteId: InboxNoteId
  text: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InboxItemUnassigned = Readonly<{
  _tag: 'inbox.item.unassigned'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  previousAssignee: UserId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InboxBulkStatusChanged = Readonly<{
  _tag: 'inbox.bulk.status.changed'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  oldStatus: InboxStatus
  newStatus: InboxStatus
  bulkId: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type InboxItemEscalated = Readonly<{
  _tag: 'inbox.item.escalated'
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  oldStatus: InboxStatus
  occurredAt: Date
}>

export type InboxEvent =
  | InboxItemCreated
  | InboxStatusChanged
  | InboxItemEscalated
  | InboxItemAssigned
  | InboxItemUnassigned
  | InboxNoteAdded
  | InboxBulkStatusChanged

// ── Event constructors ──────────────────────────────────────────────

export const inboxItemCreated = (
  args: Omit<InboxItemCreated, '_tag'>,
): InboxItemCreated => ({
  _tag: 'inbox.item.created',
  ...args,
})

export const inboxStatusChanged = (
  args: Omit<InboxStatusChanged, '_tag'>,
): InboxStatusChanged => ({
  _tag: 'inbox.status.changed',
  ...args,
})

export const inboxItemAssigned = (
  args: Omit<InboxItemAssigned, '_tag'>,
): InboxItemAssigned => ({
  _tag: 'inbox.item.assigned',
  ...args,
})

export const inboxItemUnassigned = (
  args: Omit<InboxItemUnassigned, '_tag'>,
): InboxItemUnassigned => ({
  _tag: 'inbox.item.unassigned',
  ...args,
})

export const inboxItemEscalated = (
  args: Omit<InboxItemEscalated, '_tag'>,
): InboxItemEscalated => ({
  _tag: 'inbox.item.escalated',
  ...args,
})

export const inboxNoteAdded = (args: Omit<InboxNoteAdded, '_tag'>): InboxNoteAdded => ({
  _tag: 'inbox.note.added',
  ...args,
})

export const inboxBulkStatusChanged = (
  args: Omit<InboxBulkStatusChanged, '_tag'>,
): InboxBulkStatusChanged => ({
  _tag: 'inbox.bulk.status.changed',
  ...args,
})
