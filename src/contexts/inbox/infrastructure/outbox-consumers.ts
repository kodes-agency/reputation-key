// Outbox consumer registrations for the inbox context (PRE17A A4 / BQR-2.4 /
// BQC-3.4).
//
// Registers inbox's durable event consumers with the dispatcher. Each
// consumer:
// 1. Receives an identifier-only ConsumerEvent (no review text, PII)
// 2. Checks the receipt (idempotency — dispatcher pre-checks hasReceipt)
// 3. Applies the projection via InboxCommandStore applyOnce — state change,
//    emitted facts, and the receipt co-commit in ONE transaction (no crash
//    window can lose a fact or duplicate a side effect across redelivery).
//
// BQC-3.4: review.updated gained a metadata-only refresh consumer (sourceDate/
// platform only — content never copied onto inbox items, BQC-1.2);
// review.reply.published gained the durable milestone/auto-close consumer.
// The in-process bus handlers stay as the expand-phase dual path (the
// dispatcher is off in production).

import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox/dispatcher'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '../application/ports/review-source-lookup.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import type { InboxItemId } from '#/shared/domain/ids'
import { createInboxItem as buildInboxItem } from '../domain/constructors'
import { inboxItemCreated, inboxItemStatusChanged } from '../domain/events'
import { validateTransition } from '../domain/rules'
import {
  organizationId,
  propertyId,
  reviewId,
  userId,
  unbrand,
} from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

export type InboxConsumerDeps = Readonly<{
  commandStore: InboxCommandStore
  reviewLookup: ReviewLookupPort
  reviewSourceLookup: ReviewSourceLookupPort
  inboxRepo: InboxRepository
  idGen: () => InboxItemId
  clock: () => Date
}>

const ON_REVIEW_CREATED = 'inbox.on-review-created'
const ON_REVIEW_EXPIRED = 'inbox.on-review-expired'
const ON_REVIEW_UPDATED = 'inbox.on-review-updated'
const ON_REPLY_PUBLISHED = 'inbox.on-reply-published'

type ReviewIdPayload = Readonly<{
  reviewId: string
  organizationId: string
  propertyId: string
}>

type ReviewCreatedPayload = ReviewIdPayload &
  Readonly<{
    occurredAt?: string | Date
    platform?: string
    externalId?: string
  }>

type ReplyPublishedPayload = ReviewIdPayload &
  Readonly<{
    replyId?: string
    userId?: string | null
    occurredAt?: string | Date
  }>

function asReviewCreatedPayload(payload: unknown): ReviewCreatedPayload {
  const p = payload as ReviewCreatedPayload
  return p
}

function asReviewIdPayload(payload: unknown): ReviewIdPayload {
  return payload as ReviewIdPayload
}

function asReplyPublishedPayload(payload: unknown): ReplyPublishedPayload {
  return payload as ReplyPublishedPayload
}

/** Exported for unit tests — review.created durable handler body. */
export async function handleInboxReviewCreated(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const logger = getLogger()
  const payload = asReviewCreatedPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)

  // Existence check only — BQC-1.2: content is never copied onto inbox
  // items; both fresh and expired reviews get a metadata-only item (reads
  // resolve live via the eligibility-enforcing lookup).
  const result = await deps.reviewLookup.getReviewSnippetById(rId, orgId)

  if (result.status === 'not_found') {
    logger.warn(
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-created: review not found — marking obsolete',
    )
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_CREATED, 'obsolete')
    return { status: 'obsolete' }
  }

  const sourceDate =
    payload.occurredAt != null ? new Date(payload.occurredAt) : deps.clock()

  const built = buildInboxItem({
    id: deps.idGen(),
    organizationId: orgId,
    propertyId: propertyId(payload.propertyId),
    sourceType: 'review',
    sourceId: rId,
    sourceDate,
    platform: (payload.platform as 'google') ?? 'google',
    assignedTo: null,
    clock: deps.clock,
  })
  if (built.isErr()) throw built.error
  const item = built.value

  // One tx: idempotent create + created fact (only when created) + receipt.
  const outcome = await deps.commandStore.applyReviewCreatedOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_CREATED,
    item,
    fact: inboxItemCreated({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      occurredAt: item.createdAt,
    }),
  })
  return { status: outcome }
}

/** BQC-3.4 / BQR-2.4: close open inbox item when source review expires. */
export async function handleInboxReviewExpired(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = asReviewIdPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)
  const sourceId = unbrand(rId)
  const now = deps.clock()

  const item = await deps.inboxRepo.findBySource('review', sourceId, orgId)
  if (!item) {
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_EXPIRED, 'applied')
    return { status: 'applied' }
  }

  if (validateTransition(item.status, 'closed').isErr()) {
    // Already closed (or other illegal transition) — idempotent.
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_EXPIRED, 'applied')
    return { status: 'applied' }
  }

  // One tx: guarded close + status_changed fact (only when the close lands)
  // + receipt. The pre-BQC-3.4 crash window that could lose the fact is gone.
  await deps.commandStore.applyReviewExpiredOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_EXPIRED,
    item,
    now,
    fact: inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: item.status,
      newStatus: 'closed',
      occurredAt: now,
    }),
  })
  return { status: 'applied' }
}

/**
 * BQC-3.4: review.updated metadata-only refresh (resolves the BQC-3.1
 * orphan). Only the projection-owned sourceDate/platform fields refresh —
 * content is never copied onto inbox items (BQC-1.2).
 */
export async function handleInboxReviewUpdated(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const logger = getLogger()
  const payload = asReviewIdPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)

  const item = await deps.inboxRepo.findBySource('review', unbrand(rId), orgId)
  if (!item) {
    // No projection row — nothing to refresh. Rebuild heals if the item
    // should exist; the receipt marks the event as consumed.
    logger.warn(
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-updated: no inbox item — applied no-op (rebuild heals)',
    )
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_UPDATED, 'applied')
    return { status: 'applied' }
  }

  const meta = await deps.reviewSourceLookup.getReviewSourceMetaById(rId, orgId)
  if (!meta) {
    logger.warn(
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-updated: review missing — applied no-op',
    )
    await deps.commandStore.recordReceipt(event.eventId, ON_REVIEW_UPDATED, 'applied')
    return { status: 'applied' }
  }

  await deps.commandStore.applyReviewUpdatedOnce({
    eventId: event.eventId,
    consumerName: ON_REVIEW_UPDATED,
    item,
    sourceDate: meta.sourceDate,
    platform: meta.platform,
    now: deps.clock(),
  })
  return { status: 'applied' }
}

/**
 * BQC-3.4: durable review.reply.published consumer — stamps the
 * firstReplyPublishedAt milestone and auto-closes open items (ADR 0023).
 * The in-process bus handler stays as the expand-phase dual path.
 */
export async function handleInboxReplyPublished(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const logger = getLogger()
  const payload = asReplyPublishedPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)

  const item = await deps.inboxRepo.findBySource('review', unbrand(rId), orgId)
  if (!item) {
    logger.warn(
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-reply-published: no inbox item found — applied no-op',
    )
    await deps.commandStore.recordReceipt(event.eventId, ON_REPLY_PUBLISHED, 'applied')
    return { status: 'applied' }
  }

  const occurredAt =
    payload.occurredAt != null ? new Date(payload.occurredAt) : deps.clock()

  // A published reply always records the firstReplyPublishedAt milestone,
  // even when the item is already `closed`. The status transition itself is
  // still routed through the domain rule so this handler inherits any future
  // graph changes.
  const closeItem = validateTransition(item.status, 'closed').isOk()
  const stampMilestone = item.firstReplyPublishedAt === null

  // Already closed AND the milestone is already stamped — nothing to persist.
  if (!closeItem && !stampMilestone) {
    await deps.commandStore.recordReceipt(event.eventId, ON_REPLY_PUBLISHED, 'applied')
    return { status: 'applied' }
  }

  // One tx: milestone stamp (+ guarded close) + status_changed fact (only
  // when the close lands) + receipt.
  await deps.commandStore.applyReplyPublishedOnce({
    eventId: event.eventId,
    consumerName: ON_REPLY_PUBLISHED,
    item,
    occurredAt,
    closeItem,
    stampMilestone,
    fact: closeItem
      ? inboxItemStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: item.status,
          newStatus: 'closed',
          userId: payload.userId ? userId(payload.userId) : undefined,
          occurredAt,
        })
      : null,
  })
  return { status: 'applied' }
}

/**
 * Register inbox consumers with the outbox dispatcher.
 * Called during worker startup (after bootstrap).
 */
export function registerInboxConsumers(deps: InboxConsumerDeps): void {
  const logger = getLogger()

  // Consumer names MUST stay string literals here — the event-job catalogue
  // guard discovers durable consumers by scanning registerConsumer calls.
  registerConsumer({
    eventType: 'review.created',
    consumerName: 'inbox.on-review-created',
    handler: (event) => handleInboxReviewCreated(deps, event),
  })

  registerConsumer({
    eventType: 'review.expired',
    consumerName: 'inbox.on-review-expired',
    handler: (event) => handleInboxReviewExpired(deps, event),
  })

  registerConsumer({
    eventType: 'review.updated',
    consumerName: 'inbox.on-review-updated',
    handler: (event) => handleInboxReviewUpdated(deps, event),
  })

  registerConsumer({
    eventType: 'review.reply.published',
    consumerName: 'inbox.on-reply-published',
    handler: (event) => handleInboxReplyPublished(deps, event),
  })

  logger.info('Inbox consumers registered with outbox dispatcher (4 consumers)')
}
