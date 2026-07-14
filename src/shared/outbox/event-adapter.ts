// Outbox event adapter — converts domain events to identifier-only outbox
// payloads (PRE17A A4).
//
// This module maps the rich domain event types (which may carry content like
// reviewText, reviewerName) to the slim identifier-only payloads required
// by ADR 0030. Consumers re-fetch content via lookup ports.
//
// During the expand phase (A4 step 6), producers write to BOTH the in-process
// event bus AND the outbox. The outbox records events for verification.
// In the switch phase, the in-process bus is removed and the outbox becomes
// the sole delivery mechanism.

import type { OutboxEventInsert } from '#/shared/db/schema/outbox.schema'
import type { DomainEvent } from '#/shared/events/events'

const EVENT_VERSION = 1

/**
 * Convert a domain event to an outbox insert row.
 * Strips all content (review text, reviewer name, reply text, reason) —
 * only identifiers and stable facts remain.
 */
export function toOutboxEvent(event: DomainEvent): Omit<OutboxEventInsert, 'id'> {
  const base = {
    eventVersion: EVENT_VERSION,
    createdAt: new Date(),
  }

  switch (event._tag) {
    // ── Review events ────────────────────────────────────────────
    case 'review.created':
    case 'review.updated':
      return {
        ...base,
        eventType: event._tag,
        payload: {
          reviewId: event.reviewId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
          googleReviewId: event.externalId,
          rating: event.rating,
        },
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceContext: 'review',
        sourceAggregateId: event.reviewId,
      }

    case 'review.expired':
      return {
        ...base,
        eventType: event._tag,
        payload: {
          reviewId: event.reviewId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
        },
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceContext: 'review',
        sourceAggregateId: event.reviewId,
      }

    case 'review.reply.submitted':
    case 'review.reply.approved':
    case 'review.reply.rejected':
    case 'review.reply.published':
    case 'review.reply.publish_failed':
      return {
        ...base,
        eventType: event._tag,
        payload: {
          replyId: event.replyId,
          reviewId: event.reviewId,
          organizationId: event.organizationId,
          propertyId: event.propertyId,
        },
        organizationId: event.organizationId,
        propertyId: event.propertyId,
        sourceContext: 'review',
        sourceAggregateId: event.replyId,
      }

    default:
      // For events not yet mapped, throw — forces explicit handling
      throw new Error(
        `toOutboxEvent: event type "${event._tag}" has no outbox mapping. ` +
          'Add a case to the switch or register the schema first.',
      )
  }
}
