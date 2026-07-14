// Outbox consumer registrations for the inbox context (PRE17A A4 switch phase).
//
// Registers inbox's event consumers with the dispatcher. Each consumer:
// 1. Receives an identifier-only ConsumerEvent (no review text, PII)
// 2. Checks the receipt (idempotency)
// 3. Re-fetches content via lookup ports if needed
// 4. Commits state + receipt atomically
//
// During the switch phase, BOTH the in-process bus AND the dispatcher
// handle events. In the contract phase, the in-process bus is removed.

import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox/dispatcher'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { CreateInboxItem } from '../application/use-cases/create-inbox-item'
import type { UpdateInboxStatus } from '../application/use-cases/update-inbox-status'
import { isInboxError } from '../domain/errors'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

export type InboxConsumerDeps = Readonly<{
  outboxRepo: OutboxRepository
  reviewLookup: ReviewLookupPort
  createInboxItem: CreateInboxItem
  updateInboxStatus: UpdateInboxStatus
}>

/**
 * Register inbox consumers with the outbox dispatcher.
 * Called during worker startup (after bootstrap).
 */
export function registerInboxConsumers(deps: InboxConsumerDeps): void {
  const logger = getLogger()

  // ── review.created → create inbox item ──────────────────────────
  registerConsumer({
    eventType: 'review.created',
    consumerName: 'inbox.on-review-created',
    handler: async (event: ConsumerEvent): Promise<ConsumerResult> => {
      const payload = event.payload as {
        reviewId: string
        organizationId: string
        propertyId: string
        googleReviewId: string
        rating: number
        occurredAt: string
        platform: string
      }

      // Re-fetch review content via lookup port (ADR 0030: identifier-only payloads)
      const snippet = await deps.reviewLookup.getReviewSnippetById(
        reviewId(payload.reviewId),
        organizationId(payload.organizationId),
      )

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

      try {
        await deps.createInboxItem({
          organizationId: organizationId(payload.organizationId),
          propertyId: propertyId(payload.propertyId),
          sourceType: 'review',
          sourceId: reviewId(payload.reviewId),
          rating: payload.rating,
          sourceDate: new Date(payload.occurredAt),
          platform: payload.platform as 'google',
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
    },
  })

  // ── review.updated → update inbox item (if exists) ───────────────
  registerConsumer({
    eventType: 'review.updated',
    consumerName: 'inbox.on-review-updated',
    handler: async (event: ConsumerEvent): Promise<ConsumerResult> => {
      // For review.updated, the inbox item may need to be updated with
      // new rating or content. For now, we mark as applied (no-op) since
      // the inbox item is a snapshot at creation time.
      // TODO: Implement inbox item update when product requires it.
      await deps.outboxRepo.insertReceipt(
        event.eventId,
        'inbox.on-review-updated',
        'applied',
      )
      return { status: 'applied' }
    },
  })

  // ── review.expired → close inbox item ────────────────────────────
  registerConsumer({
    eventType: 'review.expired',
    consumerName: 'inbox.on-review-expired',
    handler: async (event: ConsumerEvent): Promise<ConsumerResult> => {
      const payload = event.payload as {
        reviewId: string
        organizationId: string
        propertyId: string
      }

      // The existing on-review-expired handler auto-transitions the inbox
      // item to closed. For the outbox consumer, we do the same via
      // updateInboxStatus. The receipt ensures we don't double-process.
      try {
        // The existing handler uses a specific lookup — for the outbox
        // consumer, we'd need to find the inbox item by sourceId.
        // For now, mark as applied — the in-process bus handler still
        // handles the actual transition.
        await deps.outboxRepo.insertReceipt(
          event.eventId,
          'inbox.on-review-expired',
          'applied',
        )
        return { status: 'applied' }
      } catch (err) {
        logger.error(
          { err, reviewId: payload.reviewId, eventId: event.eventId },
          'inbox.on-review-expired: failed',
        )
        throw err
      }
    },
  })

  logger.info('Inbox consumers registered with outbox dispatcher (3 consumers)')
}
