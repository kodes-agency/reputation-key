// Durable delivery for notification-producing workflow facts.
//
// This adapter validates each stored identifier-only fact, resolves current
// recipients and copy facts, enqueues deterministic per-recipient jobs, and
// acknowledges only after every enqueue succeeds. Redelivery therefore
// converges on the same BullMQ job identities.

import type { ConsumerEvent } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
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
  inboxWorkflowNotices,
  publishFailedNotices,
  replyAuthorNotices,
  type DurableReplyPublishFailed,
  type DurableReplyRejected,
} from './inbox.server'
import { deliverNotices, type Notice, type NoticeDeliveryDeps } from './consumers.server'
import { buildInboxItemPayload } from '../infrastructure/notification-payload-facts'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
} from '../application/responsible-recipients'
import { resolveReplyApprovalRecipients } from '../application/reply-approval-recipients'
import { resolveEscalationRecipients } from '../application/escalation-recipients'
import type {
  ReplyApprovalAuthorityPort,
  ActivePropertyLookup,
} from '../application/ports/cross-context-lookups.port'
import type { NotificationAudience } from '../application/notification-audience'
import {
  publicationCancelledNotices,
  type DurableReplyPublicationCancelled,
} from '../infrastructure/publication-cancelled-notifications'
import {
  isRecordPayload,
  nullableString as nullablePayloadString,
  requiredString as requiredPayloadString,
} from '../infrastructure/outbox-payload-fields'
import { type RetireMovedAssignment } from './settle.server'

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

export type WorkflowNotificationConsumerDeps = NoticeDeliveryDeps &
  Readonly<{
    userLookup: UserLookupPort
    responsibleManagers: ResponsibleManagerLookupPort
    inboxItemLookup: InboxItemLookupPort
    /** Who may act on an approval request, asked at fan-out and again at send. */
    replyApproval: ReplyApprovalAuthorityPort
    /** Whether the Property is still inside the workspace. */
    activeProperty: ActivePropertyLookup
    /** Retires the previous holder's "Assigned to you" once an item moves on. */
    retireMovedAssignment: RetireMovedAssignment
    clock: () => Date
    logger: LoggerPort
  }>

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

async function assignmentNotices(
  deps: WorkflowNotificationConsumerDeps,
  event: InboxItemAssigned,
): Promise<ReadonlyArray<Notice>> {
  // The item moved away from whoever held it: their "Assigned to you" stops
  // waiting on them now, whether or not they are told — nobody is told about
  // a handoff they made themselves, and a bulk move notifies per group.
  const previous = event.previousAssignee ?? null
  if (previous !== null && previous !== event.assignedTo) {
    await deps.retireMovedAssignment({
      organizationId: event.organizationId,
      userId: previous,
      inboxItemId: event.inboxItemId,
      eventId: event.eventId,
      at: deps.clock(),
    })
  }
  // The atomic bulk-completion fact owns grouped delivery. Per-item facts
  // remain activity/audit facts but must not also produce N notifications.
  if (event.bulkId) return []
  const recipients = assignmentRecipients(event)
  if (recipients.length === 0) return []

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
  })
  return inboxWorkflowNotices(
    {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      resourceId: event.inboxItemId,
      payload,
    },
    recipients.map((recipient) => ({
      ...recipient,
      // The previous holder is no longer the assignee; send-time admission
      // checks their Property authority instead.
      audience:
        recipient.type === 'inbox.assigned'
          ? { kind: 'inbox_assignee', inboxItemId: event.inboxItemId }
          : { kind: 'property_operator' },
    })),
  )
}

/**
 * An escalation goes to the people who own the item's work, and to the
 * AccountAdmins when nobody there but the escalating actor can answer it
 * (I5.3, `resolveEscalationRecipients`).
 */
async function escalationNotices(
  deps: WorkflowNotificationConsumerDeps,
  event: InboxItemEscalated,
): Promise<ReadonlyArray<Notice>> {
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
    return []
  }

  // Escalating is a person's judgement call; the notice names their role.
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
    measureWait: true,
  })
  return inboxWorkflowNotices(
    {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      resourceId: event.inboxItemId,
      payload,
    },
    recipients.map((userId) => ({ userId, type: 'inbox.escalated', audience })),
  )
}

/**
 * Everyone already working on the item, and why each of them is (I15).
 *
 * The assignee, the item's responsible scope, and earlier note authors each
 * keep the audience that admitted them, so the send rechecks the right thing.
 */
async function noteRecipients(
  deps: WorkflowNotificationConsumerDeps,
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

async function noteNotices(
  deps: WorkflowNotificationConsumerDeps,
  event: InboxNoteAdded,
): Promise<ReadonlyArray<Notice>> {
  if (!event.propertyId) {
    deps.logger.debug('notification note delivery: no propertyId, skipping', {
      correlationId: event.correlationId ?? undefined,
    })
    return []
  }

  const candidates = await noteRecipients(deps, event)
  const filtered = candidates.filter((candidate) => candidate.userId !== event.userId)
  if (filtered.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'notification note delivery: no recipients after filtering, skipping',
    )
    return []
  }

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: event.inboxItemId,
    orgId: event.organizationId,
    actorId: event.userId,
  })
  return inboxWorkflowNotices(
    {
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      resourceId: event.inboxItemId,
      payload,
    },
    filtered.map((recipient) => ({ ...recipient, type: 'inbox_note.added' })),
  )
}

/**
 * An approval request goes to the Property's responsible managers who hold
 * `reply.manage`, and to the AccountAdmins only when none of them can act
 * (I5.3). The submitter is never asked: they cannot approve their own draft,
 * and an AccountAdmin who submits one needs no prompt either.
 */
async function submittedNotices(
  deps: WorkflowNotificationConsumerDeps,
  event: ReviewReplySubmitted,
): Promise<ReadonlyArray<Notice>> {
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
    return []
  }

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return []

  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    actorId: event.userId,
    measureWait: true,
  })
  return recipients.map((recipientId) => ({
    userId: recipientId,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    type: 'reply.pending_approval',
    resourceType: 'inbox_item',
    resourceId: inboxItem,
    payload,
    audience,
  }))
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

const noticesFor = (
  deps: WorkflowNotificationConsumerDeps,
  parsed: WorkflowEvent,
): Promise<ReadonlyArray<Notice>> => {
  switch (parsed._tag) {
    case 'inbox.inbox_item.assigned':
      return assignmentNotices(deps, parsed)
    case 'inbox.inbox_item.escalated':
      return escalationNotices(deps, parsed)
    case 'inbox.inbox_note.added':
      return noteNotices(deps, parsed)
    case 'review.reply.submitted':
      return submittedNotices(deps, parsed)
    case 'review.reply.approved':
    case 'review.reply.rejected':
    case 'review.reply.published':
      return replyAuthorNotices(deps, parsed)
    case 'review.reply.publish_failed':
      return publishFailedNotices(deps, parsed)
    case 'review.reply.publication_cancelled':
      return publicationCancelledNotices(deps, parsed)
    default:
      return assertNever('handleWorkflowNotificationEvent', parsed)
  }
}

export async function handleWorkflowNotificationEvent(
  deps: WorkflowNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const parsed = parseWorkflowEvent(event)
  return deliverNotices(
    deps,
    event,
    consumerNameFor(event.eventType),
    await noticesFor(deps, parsed),
  )
}
