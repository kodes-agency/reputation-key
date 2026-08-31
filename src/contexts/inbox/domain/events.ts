// Inbox context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type {
  InboxItemId,
  InboxNoteId,
  OrganizationId,
  PropertyId,
  UserId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'
import type {
  HandlingCycleActorType,
  HandlingCycleCloseReason,
  HandlingCycleOpenReason,
  InboxStatus,
  ManualReopenReason,
  SourceType,
} from './types'
import type { ResponseTargetKind, ResponseTargetReminderKind } from './response-target'

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
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.inboxItemId !== '', 'inboxItemId required')
  return {
    _tag: 'inbox.inbox_item.created',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
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
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemStatusChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.oldStatus !== args.newStatus,
    'Status change must transition to different status',
  )
  return {
    _tag: 'inbox.inbox_item.status_changed',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
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
  /** Present when this per-item fact belongs to one atomic bulk command. */
  bulkId?: string
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemAssigned = (
  args: Omit<
    InboxItemAssigned,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemAssigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.userId, 'userId required')
  return {
    _tag: 'inbox.inbox_item.assigned',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
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
  /** Present when this per-item fact belongs to one atomic bulk command. */
  bulkId?: string
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemUnassigned = (
  args: Omit<
    InboxItemUnassigned,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemUnassigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.unassigned',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxItemEscalated = Readonly<{
  _tag: 'inbox.inbox_item.escalated'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemEscalated = (
  args: Omit<
    InboxItemEscalated,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemEscalated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.escalated',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxItemEscalationResolved = Readonly<{
  _tag: 'inbox.inbox_item.escalation_resolved'
  eventId: string
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId | null
  userId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const inboxItemEscalationResolved = (
  args: Omit<
    InboxItemEscalationResolved,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemEscalationResolved => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_item.escalation_resolved',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
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
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
// BQC-3.4: events carry the note ID, never the note text — notes remain
// context-owned content (BQC-3.4 / ADR 0030); readers fetch via the note repo.
export const inboxNoteAdded = (
  args: Omit<
    InboxNoteAdded,
    '_tag' | 'correlationId' | 'eventId' | 'userId' | 'source' | 'propertyId'
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxNoteAdded => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'inbox.inbox_note.added',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
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
  > & {
    userId?: UserId
    source?: 'web' | 'import'
    propertyId?: PropertyId
    correlationId?: string | null
  },
): InboxItemBulkStatusChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.oldStatus !== args.newStatus,
    'Bulk status change must transition to different status',
  )
  return {
    _tag: 'inbox.inbox_item.bulk_status_changed',
    eventId: newEventId(),
    ...args,
    propertyId: args.propertyId ?? null,
    userId: args.userId ?? null,
    source: args.source ?? 'web',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxBulkAssignmentTransition = Readonly<{
  inboxItemId: InboxItemId
  propertyId: PropertyId
  previousAssignee: UserId | null
  nextAssignee: UserId | null
}>

/**
 * Content-free close fact for one atomic bulk assignment command. Per-item
 * assignment facts remain the activity/audit feed; this envelope lets a
 * durable consumer deliver exactly one grouped notification without guessing
 * whether every item fact in the batch has arrived.
 */
export type InboxBulkAssignmentCompleted = Readonly<{
  _tag: 'inbox.inbox_items.bulk_assignment_completed'
  eventId: string
  organizationId: OrganizationId
  userId: UserId
  bulkId: string
  transitions: ReadonlyArray<InboxBulkAssignmentTransition>
  count: number
  source: 'web'
  occurredAt: Date
  correlationId: string | null
}>

export const inboxBulkAssignmentCompleted = (args: {
  organizationId: OrganizationId
  userId: UserId
  bulkId: string
  transitions: ReadonlyArray<InboxBulkAssignmentTransition>
  occurredAt: Date
  correlationId?: string | null
}): InboxBulkAssignmentCompleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.bulkId !== '', 'bulkId required')
  assert(args.transitions.length > 0, 'bulk assignment transitions required')
  assert(args.transitions.length <= 100, 'bulk assignment limit exceeded')
  assert(
    new Set(args.transitions.map((transition) => transition.inboxItemId)).size ===
      args.transitions.length,
    'bulk assignment transitions must be unique',
  )
  assert(
    args.transitions.every(
      (transition) =>
        transition.previousAssignee !== transition.nextAssignee &&
        (transition.previousAssignee !== null || transition.nextAssignee !== null),
    ),
    'bulk assignment transitions must change an assignee',
  )
  const transitions = [...args.transitions].sort((left, right) =>
    left.inboxItemId.localeCompare(right.inboxItemId),
  )
  return {
    _tag: 'inbox.inbox_items.bulk_assignment_completed',
    eventId: newEventId(),
    organizationId: args.organizationId,
    userId: args.userId,
    bulkId: args.bulkId,
    transitions,
    count: transitions.length,
    source: 'web',
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

type HandlingCycleFactScope = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  stateRevision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceRevision: number
  actorType: HandlingCycleActorType
  userId: UserId | null
  triggerEventId: string | null
  occurredAt: Date
  correlationId?: string | null
}>

export type InboxHandlingCycleOpened = Readonly<{
  _tag: 'inbox.handling_cycle.opened'
  eventId: string
  inboxItemId: InboxItemId
  cycleNumber: number
  stateRevision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceRevision: number
  actorType: HandlingCycleActorType
  userId: UserId | null
  triggerEventId: string | null
  openReason: Exclude<HandlingCycleOpenReason, 'manual_reopen'>
  source: 'import'
  occurredAt: Date
  correlationId: string | null
}>

export const inboxHandlingCycleOpened = (
  args: HandlingCycleFactScope &
    Readonly<{ openReason: Exclude<HandlingCycleOpenReason, 'manual_reopen'> }>,
): InboxHandlingCycleOpened => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.cycleNumber > 0, 'cycleNumber must be positive')
  assert(args.sourceRevision > 0, 'sourceRevision must be positive')
  assert(args.actorType !== 'user' || args.userId !== null, 'user actor required')
  assert(args.actorType === 'user' || args.userId === null, 'system actor required')
  return {
    _tag: 'inbox.handling_cycle.opened',
    eventId: newEventId(),
    ...args,
    source: 'import',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxHandlingCycleClosed = Readonly<{
  _tag: 'inbox.handling_cycle.closed'
  eventId: string
  inboxItemId: InboxItemId
  cycleNumber: number
  stateRevision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceRevision: number
  actorType: HandlingCycleActorType
  userId: UserId | null
  triggerEventId: string | null
  closeReason: HandlingCycleCloseReason
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>

export const inboxHandlingCycleClosed = (
  args: HandlingCycleFactScope &
    Readonly<{
      closeReason: HandlingCycleCloseReason
      source?: 'web' | 'import'
      correlationId?: string | null
    }>,
): InboxHandlingCycleClosed => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.cycleNumber > 0, 'cycleNumber must be positive')
  assert(args.sourceRevision > 0, 'sourceRevision must be positive')
  assert(args.actorType !== 'user' || args.userId !== null, 'user actor required')
  assert(args.actorType === 'user' || args.userId === null, 'system actor required')
  return {
    _tag: 'inbox.handling_cycle.closed',
    eventId: newEventId(),
    ...args,
    source: args.source ?? 'import',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxHandlingCycleReopened = Readonly<{
  _tag: 'inbox.handling_cycle.reopened'
  eventId: string
  inboxItemId: InboxItemId
  cycleNumber: number
  stateRevision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceRevision: number
  actorType: HandlingCycleActorType
  userId: UserId | null
  triggerEventId: string | null
  reopenReason: ManualReopenReason | 'provider_reply_deleted' | 'provider_reply_diverged'
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>

export const inboxHandlingCycleReopened = (
  args: HandlingCycleFactScope &
    Readonly<{
      reopenReason:
        ManualReopenReason | 'provider_reply_deleted' | 'provider_reply_diverged'
      source?: 'web' | 'import'
      correlationId?: string | null
    }>,
): InboxHandlingCycleReopened => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(args.cycleNumber > 0, 'cycleNumber must be positive')
  assert(args.sourceRevision > 0, 'sourceRevision must be positive')
  assert(args.actorType !== 'user' || args.userId !== null, 'user actor required')
  assert(args.actorType === 'user' || args.userId === null, 'system actor required')
  return {
    _tag: 'inbox.handling_cycle.reopened',
    eventId: newEventId(),
    ...args,
    source: args.source ?? 'import',
    correlationId: args.correlationId ?? null,
  }
}

/**
 * Content-free durable reminder fact. Recipient and presentation decisions
 * intentionally remain downstream and must be re-authorized at delivery.
 */
export type InboxResponseTargetReminderDue = Readonly<{
  _tag: 'inbox.response_target.reminder_due'
  eventId: string
  inboxItemId: InboxItemId
  cycleNumber: number
  organizationId: OrganizationId
  propertyId: PropertyId
  targetKind: ResponseTargetKind
  reminderKind: ResponseTargetReminderKind
  scheduledFor: Date
  userId: null
  source: 'import'
  occurredAt: Date
  correlationId: string | null
}>

export const inboxResponseTargetReminderDue = (
  args: Omit<
    InboxResponseTargetReminderDue,
    '_tag' | 'eventId' | 'userId' | 'source' | 'correlationId'
  > &
    Readonly<{ correlationId?: string | null }>,
): InboxResponseTargetReminderDue => {
  assert(args.inboxItemId !== '', 'inboxItemId required')
  assert(Number.isSafeInteger(args.cycleNumber), 'cycleNumber must be safe')
  assert(args.cycleNumber > 0, 'cycleNumber must be positive')
  assert(args.scheduledFor instanceof Date, 'scheduledFor must be Date')
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(
    args.occurredAt.getTime() >= args.scheduledFor.getTime(),
    'reminder cannot be due before its scheduled time',
  )
  return {
    _tag: 'inbox.response_target.reminder_due',
    eventId: newEventId(),
    ...args,
    userId: null,
    source: 'import',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxResponseTargetPolicyChanged = Readonly<{
  _tag: 'inbox.response_target.policy_changed'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId | null
  targetKind: ResponseTargetKind
  policyScope: 'organization' | 'property'
  durationMinutes: number | null
  policyVersion: number
  userId: UserId
  source: 'web'
  occurredAt: Date
  correlationId: string | null
}>

export const inboxResponseTargetPolicyChanged = (
  args: Omit<
    InboxResponseTargetPolicyChanged,
    '_tag' | 'eventId' | 'source' | 'correlationId'
  > &
    Readonly<{ correlationId?: string | null }>,
): InboxResponseTargetPolicyChanged => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  assert(Number.isSafeInteger(args.policyVersion), 'policyVersion must be safe')
  assert(args.policyVersion > 0, 'policyVersion must be positive')
  assert(
    (args.policyScope === 'organization' && args.propertyId === null) ||
      (args.policyScope === 'property' && args.propertyId !== null),
    'Response Target policy scope is invalid',
  )
  assert(
    args.policyScope !== 'property' || args.targetKind === 'private_feedback_handling',
    'Google Review Response Target has no Property policy scope',
  )
  assert(
    (args.durationMinutes === null && args.policyScope === 'property') ||
      (args.durationMinutes !== null &&
        Number.isSafeInteger(args.durationMinutes) &&
        args.durationMinutes >= 1 &&
        args.durationMinutes <= 43_200),
    'Response Target policy duration is invalid',
  )
  return {
    _tag: 'inbox.response_target.policy_changed',
    eventId: newEventId(),
    ...args,
    source: 'web',
    correlationId: args.correlationId ?? null,
  }
}

export type InboxEvent =
  | InboxItemCreated
  | InboxItemStatusChanged
  | InboxItemEscalated
  | InboxItemEscalationResolved
  | InboxItemAssigned
  | InboxItemUnassigned
  | InboxNoteAdded
  | InboxItemBulkStatusChanged
  | InboxBulkAssignmentCompleted
  | InboxHandlingCycleOpened
  | InboxHandlingCycleClosed
  | InboxHandlingCycleReopened
  | InboxResponseTargetReminderDue
  | InboxResponseTargetPolicyChanged
