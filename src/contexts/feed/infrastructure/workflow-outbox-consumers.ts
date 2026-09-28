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
  type UserId,
} from '#/shared/domain/ids'
import { assertNever } from '#/shared/domain/assert'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  InboxItemAssigned,
  InboxItemEscalated,
  InboxNoteAdded,
} from '#/contexts/inbox/application/public-api'
import type {
  ReplyPublishFailureOutcome,
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplySubmitted,
} from '#/contexts/review/application/public-api'
import {
  enqueuePublicationCancelledNotifications,
  enqueuePublishFailedNotification,
  enqueueReplyAuthorNotification,
  type DurableReplyPublicationCancelled,
  type DurableReplyPublishFailed,
  type DurableReplyRejected,
} from './reply-outcome-notifications'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { buildInboxItemPayload } from './notification-payload-facts'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
} from '../application/responsible-recipients'
import { resolveReplyApprovalRecipients } from '../application/reply-approval-recipients'
import { resolveEscalationRecipients } from '../application/escalation-recipients'
import type { ReplyApprovalAuthorityPort } from '../application/ports/reply-approval-authority.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import type { NotificationAudience } from '../application/notification-audience'
import {
  isRecordPayload,
  nullableString as nullablePayloadString,
  requiredString as requiredPayloadString,
} from './outbox-payload-fields'

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
  {
    eventType: 'review.reply.publication_cancelled',
    consumerName: 'notification.on-review-reply-publication_cancelled',
  },
] as const

type WorkflowEventType = (typeof WORKFLOW_NOTIFICATION_CONSUMERS)[number]['eventType']

type WorkflowEvent =
  | InboxItemAssigned
  | InboxItemEscalated
  | InboxNoteAdded
  | ReviewReplySubmitted
  | ReviewReplyApproved
  | DurableReplyRejected
  | ReviewReplyPublished
  | DurableReplyPublishFailed
  | DurableReplyPublicationCancelled

export type WorkflowNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  /** Who may act on an approval request, asked at fan-out and again at send. */
  replyApproval: ReplyApprovalAuthorityPort
  clock: () => Date
  logger: LoggerPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

type WorkflowNotificationDeliveryDeps = Omit<WorkflowNotificationConsumerDeps, 'receipts'>

/**
 * Who this assignment is news to.
 *
 * The new assignee, unless they claimed it themselves. And, on a manual
 * reassignment, whoever held it before: they were never told the item had
 * moved on, so it stayed on their list (I15). An eligibility-loss release
 * carries no new assignee and never reaches this route, so it stays silent.
 */
const assignmentRecipients = (
  event: InboxItemAssigned,
): ReadonlyArray<
  Readonly<{ userId: UserId; type: 'inbox.assigned' | 'inbox.unassigned' }>
> => {
  const previous = event.previousAssignee ?? null
  return [
    // "Assign to me" is a claim: the person who clicked already knows.
    ...(event.assignedTo === event.userId
      ? []
      : [{ userId: event.assignedTo, type: 'inbox.assigned' as const }]),
    ...(previous !== null && previous !== event.userId && previous !== event.assignedTo
      ? [{ userId: previous, type: 'inbox.unassigned' as const }]
      : []),
  ]
}

async function enqueueAssignmentNotification(
  deps: WorkflowNotificationDeliveryDeps,
  event: InboxItemAssigned,
): Promise<void> {
  // The atomic bulk-completion fact owns grouped delivery. Per-item facts
  // remain activity/audit facts but must not also produce N notifications.
  if (event.bulkId) return
  const recipients = assignmentRecipients(event)
  if (recipients.length === 0) return

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
  })
  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient.userId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          type: recipient.type,
          resourceType: 'inbox_item',
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          payload,
          // The new assignee is admitted as the assignee; the previous one no
          // longer is, so they are admitted as somebody who may still act on
          // the Property.
          audience:
            recipient.type === 'inbox.assigned'
              ? { kind: 'inbox_assignee', inboxItemId: event.inboxItemId }
              : { kind: 'property_operator' },
        },
        { jobId: `${event.eventId}-${recipient.userId}` },
      ),
    ),
  )
}

/**
 * An escalation goes to the people who own the item's work, and to the
 * AccountAdmins when nobody there but the escalating actor can answer it
 * (I5.3, `resolveEscalationRecipients`).
 */
async function enqueueEscalationNotifications(
  deps: WorkflowNotificationDeliveryDeps,
  event: InboxItemEscalated,
): Promise<void> {
  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    event.inboxItemId,
    event.organizationId,
  )
  const { recipients, audience } = await resolveEscalationRecipients(
    deps,
    event.organizationId,
    facts,
    event.userId,
  )
  if (recipients.length === 0) {
    // A request for help that reaches nobody must at least leave a trace.
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'notification escalation delivery: nobody besides the escalating actor, skipping',
    )
    return
  }

  // Escalating is a person's judgement call; the notice names their role.
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
    measureWait: true,
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
          audience,
        },
        { jobId: `${event.eventId}-${recipientId}` },
      ),
    ),
  )
}

/**
 * Everyone already working on the item, and why each of them is (I15).
 *
 * A note used to reach the assignee alone, so a note written BY the assignee
 * reached nobody and notes could not be used to ask for help. It now reaches
 * the assignee, the item's responsible scope, and whoever has written on it
 * before — each under the audience that admitted them, so the send rechecks
 * the right thing.
 */
async function noteRecipients(
  deps: WorkflowNotificationDeliveryDeps,
  event: InboxNoteAdded,
): Promise<ReadonlyArray<Readonly<{ userId: UserId; audience: NotificationAudience }>>> {
  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    event.inboxItemId,
    event.organizationId,
  )
  if (!facts) {
    // The item is gone from under the note: only the AccountAdmins can be
    // told, as they are for any item whose scope cannot be resolved.
    const admins = await deps.userLookup.findByRole(event.organizationId, 'AccountAdmin')
    return admins.map((userId) => ({ userId, audience: { kind: 'account_admin' } }))
  }

  const [responsible, authors] = await Promise.all([
    resolveInboxResponsibleRecipients(deps, event.organizationId, facts),
    deps.inboxItemLookup.findNoteAuthors(event.inboxItemId, event.organizationId),
  ])
  const scope = inboxNotificationAudience(facts)
  const byUser = new Map<UserId, NotificationAudience>()
  // Weakest first, so a recipient who is several of these keeps the audience
  // that says the most about why they were admitted.
  for (const author of authors) {
    byUser.set(author, { kind: 'inbox_note_author', inboxItemId: event.inboxItemId })
  }
  for (const manager of responsible) byUser.set(manager, scope)
  if (facts.assignedTo) {
    byUser.set(facts.assignedTo, {
      kind: 'inbox_assignee',
      inboxItemId: event.inboxItemId,
    })
  }
  return [...byUser].map(([userId, audience]) => ({ userId, audience }))
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

  const candidates = await noteRecipients(deps, event)
  const filtered = candidates.filter((candidate) => candidate.userId !== event.userId)
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
  const jobs: InsertNotificationJobData[] = filtered.map((recipient) => ({
    userId: recipient.userId,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    type: 'inbox_note.added',
    resourceType: 'inbox_item',
    resourceId: event.inboxItemId,
    eventId: event.eventId,
    payload,
    audience: recipient.audience,
  }))
  await Promise.all(
    jobs.map((data) =>
      deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data, {
        jobId: `${event.eventId}-${data.userId}`,
      }),
    ),
  )
}

/**
 * An approval request goes to the Property's responsible managers who hold
 * `reply.manage`, and to the AccountAdmins only when none of them can act
 * (I5.3). The submitter is never asked: they cannot approve their own draft,
 * and an AccountAdmin who submits one needs no prompt either.
 */
async function enqueueSubmittedNotifications(
  deps: WorkflowNotificationDeliveryDeps,
  event: ReviewReplySubmitted,
): Promise<void> {
  const { recipients, audience } = await resolveReplyApprovalRecipients(deps, {
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    submitterId: event.userId,
  })
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
    measureWait: true,
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

/** Named in every malformed-payload failure these routes raise. */
const SUBJECT = 'workflow notification'
const requiredString = (payload: Readonly<Record<string, unknown>>, key: string) =>
  requiredPayloadString(payload, key, SUBJECT)

const nullableString = (payload: Readonly<Record<string, unknown>>, key: string) =>
  nullablePayloadString(payload, key, SUBJECT)

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
): ReviewReplyApproved | DurableReplyRejected | ReviewReplyPublished => {
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
    hasReason: typeof payload.hasReason === 'boolean' ? payload.hasReason : null,
  }
}

function parseWorkflowEvent(event: ConsumerEvent): WorkflowEvent {
  const parsed = validateEventPayload(event.eventType, event.eventVersion, event.payload)
  if (!isRecordPayload(parsed)) {
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
        previousAssignee: nullableString(parsed, 'previousAssignee')
          ? userId(requiredString(parsed, 'previousAssignee'))
          : null,
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
    case 'review.reply.publication_cancelled': {
      const author = nullableString(parsed, 'authorId')
      return {
        ...common,
        _tag: 'review.reply.publication_cancelled',
        replyId: replyId(requiredString(parsed, 'replyId')),
        reviewId: reviewId(requiredString(parsed, 'reviewId')),
        propertyId: requireProperty(property),
        authorId: author === null ? null : userId(author),
        // The schema admits only the closed vocabulary.
        cause: parsed.cause as DurableReplyPublicationCancelled['cause'],
      }
    }
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
        // The schema admits only the closed vocabularies, so each is kept as
        // recorded: how the publication ended, and the reconnect remedy.
        outcome:
          typeof parsed.outcome === 'string'
            ? (parsed.outcome as ReplyPublishFailureOutcome)
            : null,
        ...(parsed.cause === 'google_reauthorization_required'
          ? { cause: parsed.cause }
          : {}),
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
      await enqueuePublishFailedNotification(deps, parsed)
      break
    case 'review.reply.publication_cancelled':
      await enqueuePublicationCancelledNotifications(deps, parsed)
      break
    default:
      assertNever('handleWorkflowNotificationEvent', parsed)
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
  registerConsumer({
    eventType: 'review.reply.publication_cancelled',
    consumerName: 'notification.on-review-reply-publication_cancelled',
    module: 'notification.workflow-outbox-consumers',
    handler: (event) => handleWorkflowNotificationEvent(deps, event),
  })
}
