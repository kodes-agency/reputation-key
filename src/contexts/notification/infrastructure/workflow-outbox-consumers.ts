// Durable delivery for notification-producing workflow facts.
//
// This adapter validates each stored identifier-only fact, resolves current
// recipients and copy facts, enqueues deterministic per-recipient jobs, and
// acknowledges only after every enqueue succeeds. Redelivery therefore
// converges on the same BullMQ job identities.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
  type OrganizationId,
  type PropertyId,
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
import type { InsertNotificationJobData } from './jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { buildInboxItemPayload } from './notification-payload-facts'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
} from '../application/responsible-recipients'
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

type WorkflowNotificationDeliveryDeps = Omit<WorkflowNotificationConsumerDeps, 'receipts'>

async function enqueueAssignmentNotification(
  deps: WorkflowNotificationDeliveryDeps,
  event: InboxItemAssigned,
): Promise<void> {
  // The atomic bulk-completion fact owns grouped delivery. Per-item facts
  // remain activity/audit facts but must not also produce N notifications.
  if (event.bulkId) return

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
  })
  await deps.queue.add(
    INSERT_NOTIFICATION_JOB_NAME,
    {
      userId: event.assignedTo,
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      type: 'inbox.assigned',
      resourceType: 'inbox_item',
      resourceId: event.inboxItemId,
      eventId: event.eventId,
      payload,
      audience: {
        kind: 'inbox_assignee',
        inboxItemId: event.inboxItemId,
      },
    },
    { jobId: `${event.eventId}-${event.assignedTo}` },
  )
}

async function enqueueEscalationNotifications(
  deps: WorkflowNotificationDeliveryDeps,
  event: InboxItemEscalated,
): Promise<void> {
  const recipients = await deps.userLookup.findByRole(
    event.organizationId,
    'AccountAdmin',
  )
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'notification escalation delivery: no recipients found, skipping',
    )
    return
  }

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
  })
  await Promise.all(
    recipients.map((recipientId) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipientId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type: 'inbox.escalated',
          resourceType: 'inbox_item',
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          payload,
          audience: { kind: 'account_admin' },
        },
        { jobId: `${event.eventId}-${recipientId}` },
      ),
    ),
  )
}

async function enqueueNoteNotifications(
  deps: WorkflowNotificationDeliveryDeps,
  event: InboxNoteAdded,
): Promise<void> {
  if (!event.propertyId) {
    deps.logger.debug('notification note delivery: no propertyId, skipping', {
      correlationId: event.correlationId ?? undefined,
    })
    return
  }

  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    event.inboxItemId,
    event.organizationId,
  )
  const recipients = facts?.assignedTo
    ? [facts.assignedTo]
    : facts
      ? await resolveInboxResponsibleRecipients(deps, event.organizationId, facts)
      : await deps.userLookup.findByRole(event.organizationId, 'AccountAdmin')
  const audience = facts?.assignedTo
    ? ({ kind: 'inbox_assignee', inboxItemId: event.inboxItemId } as const)
    : facts
      ? inboxNotificationAudience(facts)
      : ({ kind: 'account_admin' } as const)
  const filtered = recipients.filter((recipientId) => recipientId !== event.userId)
  if (filtered.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'notification note delivery: no recipients after filtering, skipping',
    )
    return
  }

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
  })
  const jobs: InsertNotificationJobData[] = filtered.map((recipientId) => ({
    userId: recipientId,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    type: 'inbox_note.added',
    resourceType: 'inbox_item',
    resourceId: event.inboxItemId,
    eventId: event.eventId,
    payload,
    audience,
  }))
  await Promise.all(
    jobs.map((data) =>
      deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data, {
        jobId: `${event.eventId}-${data.userId}`,
      }),
    ),
  )
}

async function enqueueSubmittedNotifications(
  deps: WorkflowNotificationDeliveryDeps,
  event: ReviewReplySubmitted,
): Promise<void> {
  const recipients = await deps.userLookup.findByRole(
    event.organizationId,
    'AccountAdmin',
  )
  if (recipients.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'notification reply-submitted delivery: no recipients found, skipping',
    )
    return
  }

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    actorId: event.userId,
  })
  const jobs: InsertNotificationJobData[] = recipients.map((recipientId) => ({
    userId: recipientId,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    type: 'reply.pending_approval',
    resourceType: 'inbox_item',
    resourceId: inboxItem,
    eventId: event.eventId,
    payload,
    audience: { kind: 'account_admin' },
  }))
  await Promise.all(
    jobs.map((data) =>
      deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data, {
        jobId: `${event.eventId}-${data.userId}`,
      }),
    ),
  )
}

type ReplyAuthorEvent =
  | ReviewReplyApproved
  | ReviewReplyRejected
  | ReviewReplyPublished
  | ReviewReplyPublishFailed

async function enqueueReplyAuthorNotification(
  deps: WorkflowNotificationDeliveryDeps,
  event: ReplyAuthorEvent,
  type: InsertNotificationJobData['type'],
): Promise<void> {
  if (!event.authorId) return

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    moderationReason: event._tag === 'review.reply.rejected' ? event.reason : null,
  })
  await deps.queue.add(
    INSERT_NOTIFICATION_JOB_NAME,
    {
      userId: event.authorId,
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      type,
      resourceType: 'inbox_item',
      resourceId: inboxItem,
      eventId: event.eventId,
      payload,
      audience: { kind: 'property_operator' },
    },
    { jobId: `${event.eventId}-${event.authorId}` },
  )
}

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

const commonFields = (
  event: ConsumerEvent,
  org: OrganizationId,
  payload: Readonly<Record<string, unknown>>,
) =>
  ({
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: org,
    occurredAt: occurredAt(event, payload),
  }) as const

type WorkflowEventCommon = ReturnType<typeof commonFields>

/** The reply families that carry no Organization-wide fallback Property. */
const requireProperty = (property: PropertyId | null): PropertyId => {
  if (property === null) {
    throw new Error('workflow notification payload is missing propertyId')
  }
  return property
}

/**
 * The three reply-decision families share one identifier shape and differ only
 * in which actor field is mandatory.
 */
const parseReplyDecision = (
  eventType: 'review.reply.approved' | 'review.reply.rejected' | 'review.reply.published',
  payload: Readonly<Record<string, unknown>>,
  common: WorkflowEventCommon,
  property: PropertyId,
): ReviewReplyApproved | ReviewReplyRejected | ReviewReplyPublished => {
  const actor = nullableString(payload, 'userId')
  const author = nullableString(payload, 'authorId')
  const base = {
    ...common,
    replyId: replyId(requiredString(payload, 'replyId')),
    reviewId: reviewId(requiredString(payload, 'reviewId')),
    propertyId: property,
    userId: actor === null ? null : userId(actor),
    authorId: author === null ? null : userId(author),
    source: eventSource(payload),
  }
  if (eventType === 'review.reply.published') {
    return { ...base, _tag: 'review.reply.published' }
  }
  if (base.userId === null) {
    throw new Error('workflow notification payload is missing userId')
  }
  if (eventType === 'review.reply.approved') {
    return { ...base, _tag: 'review.reply.approved', userId: base.userId }
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
  const common = commonFields(event, org, parsed)

  const eventType = event.eventType as WorkflowEventType
  switch (eventType) {
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
    case 'review.reply.submitted': {
      const resolvedProperty = requireProperty(property)
      return {
        ...common,
        _tag: 'review.reply.submitted',
        replyId: replyId(requiredString(parsed, 'replyId')),
        reviewId: reviewId(requiredString(parsed, 'reviewId')),
        propertyId: resolvedProperty,
        userId: userId(requiredString(parsed, 'userId')),
        source: eventSource(parsed),
      }
    }
    case 'review.reply.approved':
    case 'review.reply.rejected':
    case 'review.reply.published':
      return parseReplyDecision(eventType, parsed, common, requireProperty(property))
    case 'review.reply.publish_failed': {
      const resolvedProperty = requireProperty(property)
      const author = nullableString(parsed, 'authorId')
      return {
        ...common,
        _tag: 'review.reply.publish_failed',
        replyId: replyId(requiredString(parsed, 'replyId')),
        reviewId: reviewId(requiredString(parsed, 'reviewId')),
        propertyId: resolvedProperty,
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

  switch (parsed._tag) {
    case 'inbox.inbox_item.assigned':
      await enqueueAssignmentNotification(deps, parsed)
      break
    case 'inbox.inbox_item.escalated':
      await enqueueEscalationNotifications(deps, parsed)
      break
    case 'inbox.inbox_note.added':
      await enqueueNoteNotifications(deps, parsed)
      break
    case 'review.reply.submitted':
      await enqueueSubmittedNotifications(deps, parsed)
      break
    case 'review.reply.approved':
      await enqueueReplyAuthorNotification(deps, parsed, 'reply.approved')
      break
    case 'review.reply.rejected':
      await enqueueReplyAuthorNotification(deps, parsed, 'reply.rejected')
      break
    case 'review.reply.published':
      await enqueueReplyAuthorNotification(deps, parsed, 'reply.published')
      break
    case 'review.reply.publish_failed':
      await enqueueReplyAuthorNotification(deps, parsed, 'reply.publish_failed')
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
  registry: ConsumerRegistry,
  deps: WorkflowNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
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
