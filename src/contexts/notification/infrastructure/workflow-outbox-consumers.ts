// Durable recovery for notification-producing workflow facts.
//
// The in-process handlers remain the single recipient/copy authority. This
// adapter validates the stored identifier-only fact, reconstructs its typed
// event envelope, invokes that same handler, and acknowledges only after every
// per-recipient job enqueue succeeds. The handlers use <eventId>-<userId> job
// identities, so immediate bus delivery and later durable replay converge.

import {
  registerConsumer,
  type ConsumerEvent,
  type OutboxRepository,
} from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  InboxItemAssigned,
  InboxItemEscalated,
  InboxNoteAdded,
} from '#/contexts/inbox/application/public-api'
import type {
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
  ReviewReplySubmitted,
} from '#/contexts/review/application/public-api'
import { onInboxItemAssigned } from './event-handlers/on-inbox-item-assigned'
import { onInboxItemEscalated } from './event-handlers/on-inbox-item-escalated'
import { onInboxNoteAdded } from './event-handlers/on-inbox-note-added'
import { onReplySubmitted } from './event-handlers/on-reply-submitted'
import { onReplyApproved } from './event-handlers/on-reply-approved'
import { onReplyRejected } from './event-handlers/on-reply-rejected'
import { onReplyPublished } from './event-handlers/on-reply-published'
import { onReplyPublishFailed } from './event-handlers/on-reply-publish-failed'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'

export const WORKFLOW_NOTIFICATION_CONSUMERS = [
  {
    eventType: 'inbox.inbox_item.assigned',
    consumerName: 'notification.on-inbox-inbox_item-assigned',
  },
  {
    eventType: 'inbox.inbox_item.escalated',
    consumerName: 'notification.on-inbox-inbox_item-escalated',
  },
  {
    eventType: 'inbox.inbox_note.added',
    consumerName: 'notification.on-inbox-inbox_note-added',
  },
  {
    eventType: 'review.reply.submitted',
    consumerName: 'notification.on-review-reply-submitted',
  },
  {
    eventType: 'review.reply.approved',
    consumerName: 'notification.on-review-reply-approved',
  },
  {
    eventType: 'review.reply.rejected',
    consumerName: 'notification.on-review-reply-rejected',
  },
  {
    eventType: 'review.reply.published',
    consumerName: 'notification.on-review-reply-published',
  },
  {
    eventType: 'review.reply.publish_failed',
    consumerName: 'notification.on-review-reply-publish_failed',
  },
] as const

type WorkflowEventType = (typeof WORKFLOW_NOTIFICATION_CONSUMERS)[number]['eventType']
type WorkflowEvent =
  | InboxItemAssigned
  | InboxItemEscalated
  | InboxNoteAdded
  | ReviewReplySubmitted
  | ReviewReplyApproved
  | ReviewReplyRejected
  | ReviewReplyPublished
  | ReviewReplyPublishFailed

export type WorkflowNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`workflow notification payload is missing ${key}`)
  }
  return value
}

const nullableString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | null => {
  const value = payload[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`workflow notification payload has invalid ${key}`)
  }
  return value
}

const occurredAt = (
  event: ConsumerEvent,
  payload: Readonly<Record<string, unknown>>,
): Date => {
  const value = payload.occurredAt ?? event.occurredAt ?? event.recordedAt
  if (typeof value !== 'string') {
    throw new Error('workflow notification payload is missing occurredAt')
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('workflow notification payload has invalid occurredAt')
  }
  return parsed
}

const eventSource = (payload: Readonly<Record<string, unknown>>): 'web' | 'import' =>
  payload.source === 'import' ? 'import' : 'web'

function validateAttribution(
  event: ConsumerEvent,
  payload: Readonly<Record<string, unknown>>,
): void {
  if (payload.organizationId !== event.organizationId) {
    throw new Error('workflow notification envelope attribution mismatch')
  }
  if ('propertyId' in payload && payload.propertyId !== event.propertyId) {
    throw new Error('workflow notification envelope attribution mismatch')
  }
}

function parseWorkflowEvent(event: ConsumerEvent): WorkflowEvent {
  const parsed = validateEventPayload(event.eventType, event.eventVersion, event.payload)
  if (!isRecord(parsed)) {
    throw new Error('workflow notification payload must be an object')
  }
  validateAttribution(event, parsed)

  const org = organizationId(requiredString(parsed, 'organizationId'))
  const propertyValue =
    'propertyId' in parsed ? nullableString(parsed, 'propertyId') : event.propertyId
  const property = propertyValue === null ? null : propertyId(propertyValue)
  const common = {
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: org,
    occurredAt: occurredAt(event, parsed),
  } as const

  switch (event.eventType as WorkflowEventType) {
    case 'inbox.inbox_item.assigned':
      return {
        ...common,
        _tag: 'inbox.inbox_item.assigned',
        inboxItemId: inboxItemId(requiredString(parsed, 'inboxItemId')),
        propertyId: property,
        userId: userId(requiredString(parsed, 'userId')),
        assignedTo: userId(requiredString(parsed, 'assignedTo')),
        ...(nullableString(parsed, 'bulkId')
          ? { bulkId: requiredString(parsed, 'bulkId') }
          : {}),
        source: eventSource(parsed),
      }
    case 'inbox.inbox_item.escalated':
      return {
        ...common,
        _tag: 'inbox.inbox_item.escalated',
        inboxItemId: inboxItemId(requiredString(parsed, 'inboxItemId')),
        propertyId: property,
        userId: nullableString(parsed, 'userId')
          ? userId(requiredString(parsed, 'userId'))
          : null,
        source: eventSource(parsed),
      }
    case 'inbox.inbox_note.added':
      return {
        ...common,
        _tag: 'inbox.inbox_note.added',
        inboxItemId: inboxItemId(requiredString(parsed, 'inboxItemId')),
        noteId: inboxNoteId(requiredString(parsed, 'noteId')),
        propertyId: property,
        userId: nullableString(parsed, 'userId')
          ? userId(requiredString(parsed, 'userId'))
          : null,
        source: eventSource(parsed),
      }
    case 'review.reply.submitted':
      if (property === null) {
        throw new Error('workflow notification payload is missing propertyId')
      }
      return {
        ...common,
        _tag: 'review.reply.submitted',
        replyId: replyId(requiredString(parsed, 'replyId')),
        reviewId: reviewId(requiredString(parsed, 'reviewId')),
        propertyId: property,
        userId: userId(requiredString(parsed, 'userId')),
        source: eventSource(parsed),
      }
    case 'review.reply.approved':
    case 'review.reply.rejected':
    case 'review.reply.published': {
      if (property === null) {
        throw new Error('workflow notification payload is missing propertyId')
      }
      const actor = nullableString(parsed, 'userId')
      const author = nullableString(parsed, 'authorId')
      const base = {
        ...common,
        replyId: replyId(requiredString(parsed, 'replyId')),
        reviewId: reviewId(requiredString(parsed, 'reviewId')),
        propertyId: property,
        userId: actor === null ? null : userId(actor),
        authorId: author === null ? null : userId(author),
        source: eventSource(parsed),
      }
      if (event.eventType === 'review.reply.approved') {
        if (base.userId === null) {
          throw new Error('workflow notification payload is missing userId')
        }
        return { ...base, _tag: 'review.reply.approved', userId: base.userId }
      }
      if (event.eventType === 'review.reply.rejected') {
        if (base.userId === null) {
          throw new Error('workflow notification payload is missing userId')
        }
        // The rejection sentence is intentionally excluded from the durable
        // fact allowlist. The deep link retains the authoritative reason.
        return {
          ...base,
          _tag: 'review.reply.rejected',
          userId: base.userId,
          reason: null,
        }
      }
      return { ...base, _tag: 'review.reply.published' }
    }
    case 'review.reply.publish_failed': {
      if (property === null) {
        throw new Error('workflow notification payload is missing propertyId')
      }
      const author = nullableString(parsed, 'authorId')
      return {
        ...common,
        _tag: 'review.reply.publish_failed',
        replyId: replyId(requiredString(parsed, 'replyId')),
        reviewId: reviewId(requiredString(parsed, 'reviewId')),
        propertyId: property,
        authorId: author === null ? null : userId(author),
      }
    }
  }

  throw new Error(`unsupported workflow notification event: ${event.eventType}`)
}

const consumerNameFor = (eventType: string): string => {
  const route = WORKFLOW_NOTIFICATION_CONSUMERS.find(
    (candidate) => candidate.eventType === eventType,
  )
  if (!route) throw new Error(`unsupported workflow notification event: ${eventType}`)
  return route.consumerName
}

export async function handleWorkflowNotificationEvent(
  deps: WorkflowNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const parsed = parseWorkflowEvent(event)
  const handlerDeps = {
    queue: deps.queue,
    userLookup: deps.userLookup,
    responsibleManagers: deps.responsibleManagers,
    inboxItemLookup: deps.inboxItemLookup,
    clock: deps.clock,
    logger: deps.logger,
  }

  switch (parsed._tag) {
    case 'inbox.inbox_item.assigned':
      await onInboxItemAssigned(handlerDeps)(parsed)
      break
    case 'inbox.inbox_item.escalated':
      await onInboxItemEscalated(handlerDeps)(parsed)
      break
    case 'inbox.inbox_note.added':
      await onInboxNoteAdded(handlerDeps)(parsed)
      break
    case 'review.reply.submitted':
      await onReplySubmitted(handlerDeps)(parsed)
      break
    case 'review.reply.approved':
      await onReplyApproved(handlerDeps)(parsed)
      break
    case 'review.reply.rejected':
      await onReplyRejected(handlerDeps)(parsed)
      break
    case 'review.reply.published':
      await onReplyPublished(handlerDeps)(parsed)
      break
    case 'review.reply.publish_failed':
      await onReplyPublishFailed(handlerDeps)(parsed)
      break
  }

  await deps.receipts.insertReceipt(
    event.eventId,
    consumerNameFor(event.eventType),
    'applied',
  )
  return { status: 'applied' }
}

export function registerWorkflowNotificationConsumers(
  deps: WorkflowNotificationConsumerDeps,
): void {
  registerConsumer({
    eventType: 'inbox.inbox_item.assigned',
    consumerName: 'notification.on-inbox-inbox_item-assigned',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.inbox_item.escalated',
    consumerName: 'notification.on-inbox-inbox_item-escalated',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.inbox_note.added',
    consumerName: 'notification.on-inbox-inbox_note-added',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.submitted',
    consumerName: 'notification.on-review-reply-submitted',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.approved',
    consumerName: 'notification.on-review-reply-approved',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.rejected',
    consumerName: 'notification.on-review-reply-rejected',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.published',
    consumerName: 'notification.on-review-reply-published',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'review.reply.publish_failed',
    consumerName: 'notification.on-review-reply-publish_failed',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
}
