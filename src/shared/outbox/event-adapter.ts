// Outbox event adapter — converts domain events to identifier-only outbox
// payloads (PRE17A A4).
//
// Generic approach: spreads the event into a plain object, strips known
// content fields (review text, reviewer identity, reply text, etc. per
// ADR 0030), and returns the slimmed payload.
//
// This handles ALL event types without individual switch cases. The
// content fields to strip are well-defined and finite.

import type { OutboxEventInsert } from '#/shared/db/schema/outbox.schema'
import type { DomainEvent } from '#/shared/events/events'

const EVENT_VERSION = 1

/**
 * Content fields that must NEVER appear in outbox payloads (ADR 0030).
 * These carry review text, reviewer identity, reply content, or other
 * sensitive/provider data. Consumers re-fetch via lookup ports.
 */
const CONTENT_FIELDS_TO_STRIP: ReadonlySet<string> = new Set([
  'reviewText',
  'text',
  'reviewerName',
  'reviewerProfilePhotoUrl',
  'rejectionReason',
  'snippet',
  'noteText',
  'replyText',
  'reason',
  'content',
])

/**
 * Convert a domain event to an outbox insert row.
 * Strips all content fields — only identifiers and stable facts remain.
 */
export function toOutboxEvent(event: DomainEvent): Omit<OutboxEventInsert, 'id'> {
  // Build the slimmed payload by spreading the event and removing content fields
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (!CONTENT_FIELDS_TO_STRIP.has(key)) {
      payload[key] = value
    }
  }

  // Extract source context from the _tag (e.g., "review.created" → "review")
  const sourceContext = event._tag.split('.')[0]

  // Extract organizationId and propertyId (present on most events)
  const organizationId = (
    'organizationId' in event ? String(event.organizationId) : ''
  ) as string
  const propertyId =
    'propertyId' in event && event.propertyId != null ? String(event.propertyId) : null

  // Extract source aggregate ID — try common ID fields
  const sourceAggregateId = extractAggregateId(event)

  return {
    eventType: event._tag,
    eventVersion: EVENT_VERSION,
    payload,
    organizationId,
    propertyId,
    sourceContext,
    sourceAggregateId,
    createdAt: new Date(),
  }
}

/**
 * Try to extract the primary aggregate ID from an event.
 * Checks common field names in priority order.
 */
function extractAggregateId(event: DomainEvent): string {
  const candidates = [
    'reviewId',
    'replyId',
    'inboxItemId',
    'noteId',
    'propertyId',
    'portalId',
    'portalGroupId',
    'portalLinkId',
    'portalLinkCategoryId',
    'teamId',
    'staffId',
    'goalId',
    'invitationId',
    'importJobId',
    'connectionId',
    'scanId',
    'ratingId',
    'feedbackId',
    'linkId',
    'userId',
    'memberUserId',
  ] as const

  for (const field of candidates) {
    if (field in event && event[field as keyof DomainEvent] != null) {
      return String(event[field as keyof DomainEvent])
    }
  }

  // Fallback: use the event ID itself
  return event.eventId
}
