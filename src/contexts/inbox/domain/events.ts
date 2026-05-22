// Inbox context — domain events
// Per architecture: "Events are facts, named in the past tense."

import type { InboxItemId, OrganizationId, PropertyId, UserId, ReviewId, FeedbackId } from '#/shared/domain/ids'
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

export type InboxEvent = InboxItemCreated | InboxStatusChanged | InboxItemAssigned

// ── Event constructors ──────────────────────────────────────────────

export const inboxItemCreated = (args: Omit<InboxItemCreated, '_tag'>): InboxItemCreated => ({
  _tag: 'inbox.item.created',
  ...args,
})

export const inboxStatusChanged = (args: Omit<InboxStatusChanged, '_tag'>): InboxStatusChanged => ({
  _tag: 'inbox.status.changed',
  ...args,
})

export const inboxItemAssigned = (args: Omit<InboxItemAssigned, '_tag'>): InboxItemAssigned => ({
  _tag: 'inbox.item.assigned',
  ...args,
})
