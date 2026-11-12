// Inbox and reply notification consumers: the one fan-out from "an inbox item
// exists" to "a notice is written for every recipient", the reply outcome
// notices, and the durable consumers for assignment release, bulk assignment,
// escalation resolution and Response Target reminders. Recipients, copy and
// timing are decided here; the Inbox's own rows are read through the
// InboxItemLookupPort.

import { z } from 'zod/v4'
import type { ConsumerEvent } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  inboxItemId as brandInboxItemId,
  organizationId,
  organizationId as brandOrganizationId,
  propertyId,
  propertyId as brandPropertyId,
  userId,
  type InboxItemId,
  type UserId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'
import type {
  ReplyPublishFailureOutcome,
  ReviewReplyApproved,
  ReviewReplyPublished,
  ReviewReplyPublishFailed,
  ReviewReplyRejected,
} from '#/contexts/review/application/public-api'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { EscalationResolutionLookupPort } from '../application/ports/escalation-resolution-lookup.port'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { NotificationAudience } from '../application/notification-audience'
import { resolveEscalationResolutionRecipients } from '../application/escalation-resolution-recipients'
import { resolveResponseTargetReminderRecipients } from '../application/response-target-reminder-recipients'
import {
  inboxNotificationAudience,
  resolveInboxResponsibleRecipients,
  resolveResponsibleRecipients,
} from '../application/responsible-recipients'
import type { NotificationType } from '../domain/notification-types'
import {
  buildInboxItemPayload,
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from '../infrastructure/notification-payload-facts'
import { deliverNotices, type Notice, type NoticeDeliveryDeps } from './consumers.server'

// ---- fanout ----
// Feed notification surface — the ONE fan-out path from "an inbox item exists" to
// "a notice is written for every recipient".
//
// The durable outbox consumer owns this definition, so recipient resolution,
// AccountAdmin fallback, source-to-type mapping, the payload allowlist, and the
// rule that Google history is never announced cannot drift.
//
// Content-free by construction: the notice carries identifiers plus the
// ADR 0046 r.8 fact allowlist that buildInboxItemPayload assembles, never
// review text, guest names or media.

/** One item's workflow fact, with each recipient's reason for admission intact. */
export const inboxWorkflowNotices = (
  common: Pick<Notice, 'organizationId' | 'propertyId' | 'resourceId' | 'payload'>,
  recipients: ReadonlyArray<Pick<Notice, 'userId' | 'type' | 'audience'>>,
): ReadonlyArray<Notice> =>
  recipients.map((recipient) => ({
    ...common,
    ...recipient,
    resourceType: 'inbox_item',
  }))

export type InboxFanoutDeps = NoticeDeliveryDeps &
  Readonly<{
    userLookup: UserLookupPort
    responsibleManagers: ResponsibleManagerLookupPort
    inboxItemLookup: InboxItemLookupPort
    clock: () => Date
    logger: LoggerPort
  }>

/**
 * `inbox_items.source_type` → the notification type. A review and a piece of
 * portal feedback are the same workflow but not the same sentence (ADR 0022),
 * and any other source type is not a user-visible notification at all.
 */
const TYPE_BY_SOURCE: Readonly<Record<string, NotificationType>> = {
  review: 'review.created',
  feedback: 'feedback.created',
}

export type InboxFanoutInput = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string | null | undefined
  sourceType: string
  correlationId?: string | null
}>

export type InboxFanoutOutcome =
  | Readonly<{
      kind: 'skipped'
      reason: 'unknown_source' | 'no_property' | 'historical_onboarding' | 'no_recipients'
    }>
  | Readonly<{ kind: 'notices'; notices: ReadonlyArray<Notice> }>

/**
 * History does not fan out (ADR 0046): a past review an import brought in is
 * not news, and announcing each one as new buries the Property's real work.
 * Only a Google review can be history; private feedback is always new.
 */
const isImportedHistory = (
  deps: InboxFanoutDeps,
  input: InboxFanoutInput,
): Promise<boolean> =>
  input.sourceType === 'review'
    ? deps.inboxItemLookup.isHistoricalOnboardingItem(
        brandInboxItemId(input.inboxItemId),
        brandOrganizationId(input.organizationId),
      )
    : Promise.resolve(false)

/**
 * Resolve current source-specific responsibility: Property for Google reviews,
 * Portal for private feedback. AccountAdmins are recovery only when no eligible
 * scoped manager remains; access and Staff attribution are never substituted.
 */
const resolveRecipients = async (
  deps: InboxFanoutDeps,
  orgId: string,
  propertyId: string,
  inboxItemId: string,
  sourceType: string,
): Promise<
  Readonly<{ recipients: readonly UserId[]; audience: NotificationAudience }>
> => {
  const org = brandOrganizationId(orgId)
  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    brandInboxItemId(inboxItemId),
    org,
  )
  if (facts) {
    return {
      recipients: await resolveInboxResponsibleRecipients(deps, org, facts),
      audience: inboxNotificationAudience(facts),
    }
  }
  if (sourceType === 'review') {
    const scope = { kind: 'property' as const, propertyId }
    return {
      recipients: await resolveResponsibleRecipients(deps, org, scope),
      audience: { kind: 'responsible_scope', scope },
    }
  }
  // Private feedback without a recoverable Portal attribution goes only to
  // AccountAdmin recovery, never to access holders or arbitrary Property staff.
  return {
    recipients: await deps.userLookup.findByRole(org, 'AccountAdmin'),
    audience: { kind: 'account_admin' },
  }
}

/**
 * One notice per recipient for a single inbox item. Returns why there are none
 * rather than logging-and-returning, so the durable consumer can turn
 * "nothing to do" into an `obsolete` receipt.
 */
export const inboxItemCreatedNotices = async (
  deps: InboxFanoutDeps,
  input: InboxFanoutInput,
): Promise<InboxFanoutOutcome> => {
  const correlationId = input.correlationId ?? undefined
  const type = TYPE_BY_SOURCE[input.sourceType]
  if (type === undefined) {
    deps.logger.debug('inbox notification fan-out: skipping unknown source', {
      sourceType: input.sourceType,
    })
    return { kind: 'skipped', reason: 'unknown_source' }
  }

  const property = input.propertyId
  if (!property) {
    deps.logger.debug('inbox notification fan-out: no propertyId, skipping', {
      correlationId,
    })
    return { kind: 'skipped', reason: 'no_property' }
  }

  if (await isImportedHistory(deps, input)) {
    deps.logger.debug(
      { correlationId },
      'inbox notification fan-out: Google history is never announced',
    )
    return { kind: 'skipped', reason: 'historical_onboarding' }
  }

  const { recipients, audience } = await resolveRecipients(
    deps,
    input.organizationId,
    property,
    input.inboxItemId,
    input.sourceType,
  )
  if (recipients.length === 0) {
    deps.logger.warn({ correlationId }, 'inbox notification fan-out: no recipients found')
    return { kind: 'skipped', reason: 'no_recipients' }
  }

  // No actor: nobody on the team created this, a guest did — and a guest is
  // never named in a notification (ADR 0046 r.8).
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: brandInboxItemId(input.inboxItemId),
    orgId: brandOrganizationId(input.organizationId),
  })

  return {
    kind: 'notices',
    notices: recipients.map((recipient) => ({
      userId: recipient,
      organizationId: brandOrganizationId(input.organizationId),
      propertyId: brandPropertyId(property),
      type,
      resourceType: 'inbox_item',
      resourceId: brandInboxItemId(input.inboxItemId),
      payload,
      audience,
    })),
  }
}

// ---- reply ----
// Durable delivery of a reply's outcomes — approved, rejected, published,
// failed to publish. Each reaches the reply's author, whoever put it up for
// approval; a failure the author cannot retry reaches whoever can act on the
// reply next. A cancellation after approval has its own module
// (publication-cancelled-notifications.ts): its audience also depends on the
// Property's lifecycle.
//
// Split from workflow-outbox-consumers.ts, which parses the facts and routes
// them here: the reply routes are one family and change together.

export type ReplyOutcomeNotificationDeps = Readonly<{
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  logger: LoggerPort
}>

/**
 * The durable rejection fact. The reason stays on the reply (ADR 0030); the
 * fact says only whether there is one, and a fact recorded before it said so
 * says neither (`null`).
 */
export type DurableReplyRejected = Omit<ReviewReplyRejected, 'reason' | 'hasReason'> &
  Readonly<{ hasReason: boolean | null }>

/**
 * The durable publish-failure fact. One recorded before it said how the
 * publication ended says nothing (`null`), and the notice claims no cause.
 */
export type DurableReplyPublishFailed = Omit<ReviewReplyPublishFailed, 'outcome'> &
  Readonly<{ outcome: ReplyPublishFailureOutcome | null }>

type ReplyAuthorEvent =
  | ReviewReplyApproved
  | DurableReplyRejected
  | ReviewReplyPublished
  | DurableReplyPublishFailed

/** Who approved or rejected. Publication outcomes come from Google, not a person. */
const replyDecider = (event: ReplyAuthorEvent): UserId | null =>
  event._tag === 'review.reply.approved' || event._tag === 'review.reply.rejected'
    ? event.userId
    : null

const NOTICE_TYPES = {
  'review.reply.approved': 'reply.approved',
  'review.reply.rejected': 'reply.rejected',
  'review.reply.published': 'reply.published',
  'review.reply.publish_failed': 'reply.publish_failed',
} as const satisfies Record<ReplyAuthorEvent['_tag'], Notice['type']>

async function replyOutcomeNotices(
  deps: ReplyOutcomeNotificationDeps,
  event: ReplyAuthorEvent,
  inboxItem: InboxItemId,
  recipients: ReadonlyArray<UserId>,
  audience: NotificationAudience,
): Promise<ReadonlyArray<Notice>> {
  const payload = await buildInboxItemPayload(deps, {
    inboxItemId: inboxItem,
    orgId: event.organizationId,
    hasModerationReason: event._tag === 'review.reply.rejected' ? event.hasReason : null,
    publishOutcome: event._tag === 'review.reply.publish_failed' ? event.outcome : null,
    publishFailureCause:
      event._tag === 'review.reply.publish_failed' ? (event.cause ?? null) : null,
  })
  return recipients.map((recipientId) => ({
    userId: recipientId,
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    type: NOTICE_TYPES[event._tag],
    resourceType: 'inbox_item' as const,
    resourceId: inboxItem,
    payload,
    audience,
  }))
}

export async function replyAuthorNotices(
  deps: ReplyOutcomeNotificationDeps,
  event: ReplyAuthorEvent,
): Promise<ReadonlyArray<Notice>> {
  if (!event.authorId) return []
  // Deciding on your own reply is not news to you; Google's verdict still is.
  if (replyDecider(event) === event.authorId) return []

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return []

  return replyOutcomeNotices(deps, event, inboxItem, [event.authorId], {
    kind: 'property_operator',
  })
}

/**
 * A reply that failed to publish still needs someone to retry it. The author
 * gets the notice while they can still act on the Property. Otherwise — they
 * left, lost access, or are unknown — the Property's responsible managers own
 * this Google work and get it (AccountAdmins when none is eligible). Delivery
 * rechecks whichever audience was chosen.
 */
export async function publishFailedNotices(
  deps: ReplyOutcomeNotificationDeps,
  event: DurableReplyPublishFailed,
): Promise<ReadonlyArray<Notice>> {
  const authorCanRetry =
    event.authorId !== null &&
    (await deps.responsibleManagers.isEligibleForProperty(
      event.organizationId,
      event.propertyId,
      event.authorId,
    ))
  if (authorCanRetry) return replyAuthorNotices(deps, event)

  const inboxItem = await deps.inboxItemLookup.findInboxItemByReviewId(
    event.reviewId,
    event.organizationId,
  )
  if (!inboxItem) return []
  const scope = { kind: 'property', propertyId: event.propertyId } as const
  const recipients = await resolveResponsibleRecipients(deps, event.organizationId, scope)
  return replyOutcomeNotices(deps, event, inboxItem, recipients, {
    kind: 'responsible_scope',
    scope,
  })
}

// ---- release ----
// Durable grouped delivery for one release of a member's Inbox assignments.
//
// When a member is offboarded, or loses the authority an assignment rested on,
// their items are unassigned. The per-item `inbox.inbox_item.unassigned` facts
// remain activity history and deliberately do not notify: the news is not that
// item #37 changed hands, it is that a pile of work at a Property now belongs
// to nobody. The grouped close fact is the replay boundary, and this consumer
// turns it into ONE notice per Property, to the people who now own that gap.

export const ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER =
  'notification.on-inbox-assignments-released' as const

export type AssignmentReleaseNotificationConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    userLookup: Pick<UserLookupPort, 'findByRole'>
    responsibleManagers: ResponsibleManagerLookupPort
    logger: LoggerPort
  }>

type ReleaseGroup = Readonly<{
  propertyId: string
  anchorInboxItemId: string
  count: number
}>

type ReleasePayload = Readonly<{
  organizationId: string
  userId: string | null
  releasedFrom: string
  releaseReason: 'member_offboarded' | 'member_became_ineligible'
  releases: ReadonlyArray<ReleaseGroup>
  count: number
}>

function parseRelease(event: ConsumerEvent): ReleasePayload {
  const payload = validateEventPayload(
    'inbox.inbox_items.assignments_released',
    event.eventVersion,
    event.payload,
  ) as ReleasePayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Inbox assignment-release envelope attribution mismatch')
  }
  const total = payload.releases.reduce((sum, release) => sum + release.count, 0)
  if (
    payload.count !== total ||
    new Set(payload.releases.map((release) => release.propertyId)).size !==
      payload.releases.length
  ) {
    throw new Error('Inbox assignment-release completion contract is invalid')
  }
  return payload
}

export async function handleNotificationAssignmentsReleased(
  deps: AssignmentReleaseNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parseRelease(event)
  const org = organizationId(payload.organizationId)
  const departing = userId(payload.releasedFrom)
  const actor = payload.userId === null ? null : userId(payload.userId)

  const perProperty = await Promise.all(
    payload.releases.map(async (release): Promise<ReadonlyArray<Notice>> => {
      const property = release.propertyId
      const scope = { kind: 'property', propertyId: property } as const
      const recipients = (await resolveResponsibleRecipients(deps, org, scope)).filter(
        // The departing member no longer owns this work, and the person who
        // released them already knows: nobody is told about their own action.
        (recipientId: UserId) => recipientId !== departing && recipientId !== actor,
      )
      if (recipients.length === 0) {
        deps.logger.warn(
          { correlationId: event.correlationId ?? undefined },
          'Inbox assignment-release notification has no recipients for a Property',
        )
        return []
      }
      const where = await buildPropertyPayload(deps, org, propertyId(property))
      return recipients.map((recipientId) => ({
        userId: recipientId,
        organizationId: org,
        propertyId: propertyId(property),
        type: 'inbox.assignments_released' as const,
        resourceType: 'inbox_item' as const,
        // The row stands for the whole group; its link opens the
        // Property's open queue rather than this one item.
        resourceId: inboxItemId(release.anchorInboxItemId),
        payload: { ...where, itemCount: release.count },
        audience: { kind: 'responsible_scope' as const, scope },
      }))
    }),
  )

  return deliverNotices(
    deps,
    event,
    ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER,
    perProperty.flat(),
  )
}

// ---- bulk ----
// Durable grouped delivery for one atomic Inbox bulk-assignment completion.
// The completion fact is the replay boundary; bulk-linked per-item assignment
// facts remain activity history and deliberately do not notify independently.
// It tells the new assignee and each previous holder, once per Property.

export const ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER =
  'notification.on-inbox-bulk-assignment-completed' as const

export type BulkAssignmentNotificationConsumerDeps = PropertyPayloadDeps &
  NoticeDeliveryDeps &
  Readonly<{
    userLookup: Pick<UserLookupPort, 'findActorRole'>
  }>

type Transition = Readonly<{
  inboxItemId: string
  propertyId: string
  previousAssignee: string | null
  nextAssignee: string | null
}>

type BulkPayload = Readonly<{
  organizationId: string
  userId: string
  bulkId: string
  transitions: ReadonlyArray<Transition>
  count: number
  source: 'web'
  occurredAt: string
}>

const uuid = z.uuid()

function parseBulk(event: ConsumerEvent): BulkPayload {
  const payload = validateEventPayload(
    'inbox.inbox_items.bulk_assignment_completed',
    event.eventVersion,
    event.payload,
  ) as BulkPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Inbox bulk-assignment envelope attribution mismatch')
  }
  if (
    event.eventVersion !== 1 ||
    payload.count !== payload.transitions.length ||
    !uuid.safeParse(payload.bulkId).success ||
    !isSafeOpaqueIdentifier(payload.organizationId) ||
    !isSafeOpaqueIdentifier(payload.userId)
  ) {
    throw new Error('Inbox bulk-assignment completion contract is invalid')
  }
  const sorted = [...payload.transitions].sort((left, right) =>
    left.inboxItemId.localeCompare(right.inboxItemId),
  )
  if (
    sorted.some(
      (transition, index) =>
        transition !== payload.transitions[index] ||
        !uuid.safeParse(transition.inboxItemId).success ||
        !uuid.safeParse(transition.propertyId).success ||
        (transition.nextAssignee !== null &&
          !isSafeOpaqueIdentifier(transition.nextAssignee)) ||
        (transition.previousAssignee !== null &&
          !isSafeOpaqueIdentifier(transition.previousAssignee)),
    )
  ) {
    throw new Error('Inbox bulk-assignment transitions are not canonical identifiers')
  }
  const nextAssignees = new Set(
    payload.transitions.map((transition) => transition.nextAssignee ?? 'released'),
  )
  if (nextAssignees.size !== 1) {
    throw new Error('Inbox bulk-assignment completion has multiple target assignees')
  }
  return payload
}

/** One grouped notice: one recipient, one Property, the items it stands for. */
type NoticeGroup = Readonly<{
  recipient: string
  propertyId: string
  type: 'inbox.bulk_assigned' | 'inbox.bulk_unassigned'
  inboxItemIds: ReadonlyArray<string>
}>

type RecipientGroup = Omit<NoticeGroup, 'type'>

/** Transitions grouped by recipient and Property, in canonical (item id) order. */
const groupBy = (
  transitions: ReadonlyArray<Transition>,
  recipientOf: (transition: Transition) => string | null,
): ReadonlyArray<RecipientGroup> => {
  const groups = new Map<
    string,
    { recipient: string; propertyId: string; inboxItemIds: string[] }
  >()
  for (const transition of transitions) {
    const recipient = recipientOf(transition)
    if (recipient === null) continue
    const key = `${recipient}\u0000${transition.propertyId}`
    const group = groups.get(key) ?? {
      recipient,
      propertyId: transition.propertyId,
      inboxItemIds: [],
    }
    group.inboxItemIds.push(transition.inboxItemId)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/**
 * Who each bulk assignment is news to, one notice per recipient per Property.
 *
 * The new assignee, unless the actor took the items themselves. And, as a
 * single reassignment already does, whoever held an item before: they were
 * never told it had moved on (I15). A holder who moved their own items knows,
 * and a release has no new holder to hand anything to, so it stays silent
 * like a single-item release — the actor already knows, and AccountAdmins are
 * not a substitute recipient.
 */
const noticeGroups = (payload: BulkPayload): ReadonlyArray<NoticeGroup> => {
  const nextAssignee = payload.transitions[0]!.nextAssignee
  if (nextAssignee === null) return []
  const assigned =
    nextAssignee === payload.userId
      ? []
      : groupBy(payload.transitions, () => nextAssignee).map((group) => ({
          ...group,
          type: 'inbox.bulk_assigned' as const,
        }))
  const unassigned = groupBy(payload.transitions, ({ previousAssignee }) =>
    previousAssignee !== payload.userId && previousAssignee !== nextAssignee
      ? previousAssignee
      : null,
  ).map((group) => ({ ...group, type: 'inbox.bulk_unassigned' as const }))
  return [...assigned, ...unassigned]
}

export async function handleNotificationBulkAssignmentCompleted(
  deps: BulkAssignmentNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parseBulk(event)
  const groups = noticeGroups(payload)

  let notices: ReadonlyArray<Notice> = []
  if (groups.length > 0) {
    const org = organizationId(payload.organizationId)
    const actorRole = await deps.userLookup.findActorRole(userId(payload.userId), org)
    notices = await Promise.all(
      groups.map(async (group): Promise<Notice> => {
        const inboxItemIds = group.inboxItemIds.map(inboxItemId)
        const recipient = userId(group.recipient)
        const property = propertyId(group.propertyId)
        const where = await buildPropertyPayload(deps, org, property)
        const assigned = group.type === 'inbox.bulk_assigned'
        return {
          userId: recipient,
          organizationId: org,
          propertyId: property,
          type: group.type,
          resourceType: 'inbox_item' as const,
          // The first canonically sorted item is the row's resource identity;
          // its link opens a queue at this Property instead
          // (notificationLink), since the row stands for the whole group.
          resourceId: inboxItemIds[0]!,
          payload: {
            ...where,
            itemCount: inboxItemIds.length,
            ...(actorRole ? { actorRole } : {}),
          },
          // The new assignee is admitted for the items still theirs; a
          // previous holder no longer holds them, so they are admitted as
          // somebody who may still act on the Property.
          audience: assigned
            ? { kind: 'bulk_inbox_assignee' as const, inboxItemIds }
            : { kind: 'property_operator' as const },
        }
      }),
    )
  }

  return deliverNotices(deps, event, ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER, notices)
}

// ---- escalation ----
export const ON_INBOX_ESCALATION_RESOLVED_CONSUMER =
  'notification.on-inbox-escalation-resolved' as const

export type EscalationResolutionNotificationConsumerDeps = NoticeDeliveryDeps &
  Readonly<{
    escalationResolutions: EscalationResolutionLookupPort
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    /** The evidence of who was told the escalation was raised. */
    notifications: Pick<NotificationRepositoryPort, 'findRecipientsOfNotice'>
    /** Which scope the escalation went to, so the resolution follows it. */
    inboxItemLookup: Pick<InboxItemLookupPort, 'findInboxItemFacts'>
  }>

type EscalationPayload = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId?: string | null
  userId?: string | null
  occurredAt?: string
}>

type EscalationParsed = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string | null
  resolvedBy: string | null
  occurredAt: Date | null
}>

function parseEscalation(event: ConsumerEvent): EscalationParsed {
  const payload = validateEventPayload(
    'inbox.inbox_item.escalation_resolved',
    event.eventVersion,
    event.payload,
  ) as EscalationPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Inbox escalation-resolution envelope attribution mismatch')
  }
  if (payload.propertyId !== undefined && payload.propertyId !== event.propertyId) {
    throw new Error('Inbox escalation-resolution envelope attribution mismatch')
  }
  const occurredAtValue = payload.occurredAt ?? event.occurredAt
  const occurredAt = occurredAtValue ? new Date(occurredAtValue) : null
  return {
    inboxItemId: payload.inboxItemId,
    organizationId: payload.organizationId,
    propertyId: payload.propertyId ?? event.propertyId,
    resolvedBy: payload.userId ?? null,
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
  }
}

export async function handleNotificationInboxEscalationResolved(
  deps: EscalationResolutionNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parseEscalation(event)
  const orgId = organizationId(payload.organizationId)
  const itemId = inboxItemId(payload.inboxItemId)
  const facts = await deps.escalationResolutions.findEscalationResolutionFacts(
    itemId,
    orgId,
  )
  const resolvedBy = payload.resolvedBy ? userId(payload.resolvedBy) : null

  // The row must still represent this exact resolution. Re-escalation, a
  // later resolution, deletion, or attribution drift makes the old event
  // obsolete rather than a reason to notify current managers.
  if (
    !facts ||
    payload.propertyId === null ||
    facts.propertyId !== payload.propertyId ||
    facts.isEscalated ||
    payload.occurredAt === null ||
    facts.resolvedAt?.getTime() !== payload.occurredAt.getTime() ||
    facts.resolvedBy !== resolvedBy
  ) {
    return deliverNotices(deps, event, ON_INBOX_ESCALATION_RESOLVED_CONSUMER, [], {
      status: 'obsolete',
    })
  }

  const recipients = await resolveEscalationResolutionRecipients(deps, {
    organizationId: orgId,
    propertyId: facts.propertyId,
    inboxItemId: itemId,
    assignedTo: facts.assignedTo,
    resolvedBy: facts.resolvedBy,
    escalatedAt: facts.escalatedAt,
  })
  const resolvedAt = facts.resolvedAt.toISOString()
  const notificationPayload = facts.propertyName
    ? { propertyName: facts.propertyName }
    : {}

  return deliverNotices(
    deps,
    event,
    ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: orgId,
      propertyId: facts.propertyId,
      type: 'inbox.escalation_resolved' as const,
      resourceType: 'inbox_item' as const,
      resourceId: itemId,
      payload: notificationPayload,
      audience: {
        kind: 'escalation_resolution' as const,
        inboxItemId: itemId,
        resolvedAt,
        resolvedBy: facts.resolvedBy,
      },
    })),
  )
}

// ---- target ----
// Durable delivery for one-shot Inbox Response Target reminders.
//
// The Inbox event is only a candidate. Notification resolves the exact active
// target before fan-out, and the queued audience resolves it again before
// materialization. Completion, cancellation, cycle replacement, and recipient
// changes therefore fail closed without turning a timing reminder into an
// escalation or leaking source content.

const EVENT_TYPE = 'inbox.response_target.reminder_due' as const

export const ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER =
  'notification.on-inbox-response-target-reminder-due' as const

export type ResponseTargetNotificationConsumerDeps = InboxFanoutDeps & NoticeDeliveryDeps

type ResponseTargetReminderPayload = Readonly<{
  inboxItemId: string
  cycleNumber: number
  organizationId: string
  propertyId: string
  targetKind: 'google_review_response' | 'private_feedback_handling'
  reminderKind: 'halfway' | 'target_passed'
  scheduledFor: string
  userId: null
  source: 'import'
  occurredAt: string
}>

function parseTarget(event: ConsumerEvent): ResponseTargetReminderPayload {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Unsupported Inbox Response Target notification event')
  }
  const payload = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  ) as ResponseTargetReminderPayload | undefined
  if (
    event.eventVersion !== 1 ||
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Inbox Response Target notification envelope attribution mismatch')
  }
  return payload
}

const notificationTypeFor = (
  reminderKind: ResponseTargetReminderPayload['reminderKind'],
): NotificationType =>
  reminderKind === 'halfway'
    ? 'inbox.response_target_halfway'
    : 'inbox.response_target_passed'

export async function handleNotificationResponseTargetReminder(
  deps: ResponseTargetNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parseTarget(event)
  const orgId = organizationId(payload.organizationId)
  const itemId = inboxItemId(payload.inboxItemId)
  const scheduledFor = new Date(payload.scheduledFor)
  const facts = await deps.inboxItemLookup.findResponseTargetReminderNotificationFacts({
    inboxItemId: itemId,
    organizationId: orgId,
    cycleNumber: payload.cycleNumber,
    targetKind: payload.targetKind,
    reminderKind: payload.reminderKind,
    scheduledFor,
  })
  if (
    !facts ||
    facts.propertyId !== payload.propertyId ||
    facts.currentCycleNumber !== payload.cycleNumber ||
    facts.status !== 'open' ||
    facts.targetKind !== payload.targetKind ||
    facts.reminderKind !== payload.reminderKind ||
    facts.scheduledFor.toISOString() !== payload.scheduledFor
  ) {
    return deliverNotices(
      deps,
      event,
      ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
      [],
      { status: 'obsolete' },
    )
  }

  const recipients = await resolveResponseTargetReminderRecipients(deps, orgId, facts)
  const notificationPayload = {
    ...(await buildInboxItemPayload(deps, {
      inboxItemId: itemId,
      orgId,
      measureWait: true,
    })),
    // What the reminder is actually about. Stored as the instant, because the
    // copy renders it on each READER's clock and two people responsible for
    // one item need not share a timezone.
    targetDueAt: facts.dueAt.toISOString(),
  }
  const audience: NotificationAudience = {
    kind: 'response_target_reminder',
    inboxItemId: itemId,
    sourceType: facts.sourceType,
    sourceId: facts.sourceId,
    cycleNumber: facts.currentCycleNumber,
    sourceRevision: facts.currentSourceRevision,
    stateRevision: facts.stateRevision,
    targetKind: facts.targetKind,
    reminderKind: facts.reminderKind,
    scheduledFor: facts.scheduledFor.toISOString(),
  }

  return deliverNotices(
    deps,
    event,
    ON_INBOX_RESPONSE_TARGET_REMINDER_DUE_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: orgId,
      propertyId: propertyId(payload.propertyId),
      type: notificationTypeFor(payload.reminderKind),
      resourceType: 'inbox_item' as const,
      resourceId: itemId,
      payload: notificationPayload,
      audience,
    })),
  )
}
