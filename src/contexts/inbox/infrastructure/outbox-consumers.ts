// Outbox consumer registrations for the inbox context (PRE17A A4 / BQR-2.4).
//
// Registers inbox's event consumers with the dispatcher. Each consumer:
// 1. Receives an identifier-only ConsumerEvent (no review text, PII)
// 2. Checks the receipt (idempotency — dispatcher pre-checks hasReceipt)
// 3. Re-fetches content via lookup ports if needed (ADR 0030)
// 4. Applies projection side effects and records a receipt
//
// BQR-2.4: review.updated and review.expired perform real work (no no-op
// applied receipts). System path uses the repository (not auth-gated use cases).

import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox'
import { emitAndRecord } from '#/shared/outbox'
import type { EventBus } from '#/shared/events/event-bus'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { CreateInboxItem } from '../application/use-cases/create-inbox-item'
import { isInboxError } from '../domain/errors'
import { inboxItemStatusChanged } from '../domain/events'
import { validateTransition } from '../domain/rules'
import { organizationId, propertyId, reviewId, unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

export type InboxConsumerDeps = Readonly<{
  outboxRepo: OutboxRepository
  reviewLookup: ReviewLookupPort
  createInboxItem: CreateInboxItem
  inboxRepo: InboxRepository
  events: EventBus
  clock: () => Date
}>

type ReviewIdPayload = Readonly<{
  reviewId: string
  organizationId: string
  propertyId: string
}>

type ReviewCreatedPayload = ReviewIdPayload &
  Readonly<{
    rating: number
    occurredAt?: string | Date
    platform?: string
    externalId?: string
  }>

type ReviewUpdatedPayload = ReviewIdPayload &
  Readonly<{
    rating: number
  }>

function asReviewCreatedPayload(payload: unknown): ReviewCreatedPayload {
  const p = payload as ReviewCreatedPayload
  return p
}

function asReviewUpdatedPayload(payload: unknown): ReviewUpdatedPayload {
  return payload as ReviewUpdatedPayload
}

function asReviewIdPayload(payload: unknown): ReviewIdPayload {
  return payload as ReviewIdPayload
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

  const snippet = await deps.reviewLookup.getReviewSnippetById(rId, orgId)

  if (!snippet) {
    logger.warn(
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-created: review not found — marking obsolete',
    )
    await deps.outboxRepo.insertReceipt(
      event.eventId,
      'inbox.on-review-created',
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const sourceDate =
    payload.occurredAt != null ? new Date(payload.occurredAt) : deps.clock()

  try {
    await deps.createInboxItem({
      organizationId: orgId,
      propertyId: propertyId(payload.propertyId),
      sourceType: 'review',
      sourceId: rId,
      rating: payload.rating,
      sourceDate,
      platform: (payload.platform as 'google') ?? 'google',
      snippet: snippet.text ?? null,
      reviewerName: snippet.reviewerName,
    })
    await deps.outboxRepo.insertReceipt(
      event.eventId,
      'inbox.on-review-created',
      'applied',
    )
    return { status: 'applied' }
  } catch (err: unknown) {
    if (isInboxError(err) && err.code === 'already_exists') {
      await deps.outboxRepo.insertReceipt(
        event.eventId,
        'inbox.on-review-created',
        'duplicate',
      )
      return { status: 'duplicate' }
    }
    throw err
  }
}

/**
 * BQR-2.4: sync denormalized inbox fields from identifier-only event + lookup.
 * Mirrors on-review-updated in-process handler.
 */
export async function handleInboxReviewUpdated(
  deps: InboxConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const logger = getLogger()
  const payload = asReviewUpdatedPayload(event.payload)
  const orgId = organizationId(payload.organizationId)
  const rId = reviewId(payload.reviewId)
  const sourceId = unbrand(rId)

  const item = await deps.inboxRepo.findBySource('review', sourceId, orgId)
  if (!item) {
    // No inbox projection yet — nothing to update; not an error.
    await deps.outboxRepo.insertReceipt(
      event.eventId,
      'inbox.on-review-updated',
      'applied',
    )
    return { status: 'applied' }
  }

  // ADR 0030: re-fetch content; rating is a stable identifier-adjacent fact on payload.
  const snippet = await deps.reviewLookup.getReviewSnippetById(rId, orgId)
  if (!snippet) {
    logger.warn(
      { reviewId: payload.reviewId, eventId: event.eventId },
      'inbox.on-review-updated: review not found — marking obsolete',
    )
    await deps.outboxRepo.insertReceipt(
      event.eventId,
      'inbox.on-review-updated',
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  await deps.inboxRepo.syncDenormalizedFields(item.id, item.organizationId, {
    rating: payload.rating,
    snippet: snippet.text ?? undefined,
    reviewerName: snippet.reviewerName,
  })

  await deps.outboxRepo.insertReceipt(event.eventId, 'inbox.on-review-updated', 'applied')
  return { status: 'applied' }
}

/**
 * BQR-2.4: close open inbox item when source review expires.
 * Mirrors on-review-expired in-process handler.
 */
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
    await deps.outboxRepo.insertReceipt(
      event.eventId,
      'inbox.on-review-expired',
      'applied',
    )
    return { status: 'applied' }
  }

  if (validateTransition(item.status, 'closed').isErr()) {
    // Already closed (or other illegal transition) — idempotent success.
    await deps.outboxRepo.insertReceipt(
      event.eventId,
      'inbox.on-review-expired',
      'applied',
    )
    return { status: 'applied' }
  }

  const oldStatus = item.status
  await deps.inboxRepo.updateStatus(
    item.id,
    item.organizationId,
    'closed',
    { closedAt: now },
    now,
  )

  await emitAndRecord(
    deps.events,
    deps.outboxRepo,
    inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus,
      newStatus: 'closed',
      occurredAt: now,
    }),
  )

  await deps.outboxRepo.insertReceipt(event.eventId, 'inbox.on-review-expired', 'applied')
  return { status: 'applied' }
}

/**
 * Register inbox consumers with the outbox dispatcher.
 * Called during worker startup (after bootstrap).
 */
export function registerInboxConsumers(deps: InboxConsumerDeps): void {
  const logger = getLogger()

  registerConsumer({
    eventType: 'review.created',
    consumerName: 'inbox.on-review-created',
    handler: (event) => handleInboxReviewCreated(deps, event),
  })

  registerConsumer({
    eventType: 'review.updated',
    consumerName: 'inbox.on-review-updated',
    handler: (event) => handleInboxReviewUpdated(deps, event),
  })

  registerConsumer({
    eventType: 'review.expired',
    consumerName: 'inbox.on-review-expired',
    handler: (event) => handleInboxReviewExpired(deps, event),
  })

  logger.info('Inbox consumers registered with outbox dispatcher (3 consumers)')
}
