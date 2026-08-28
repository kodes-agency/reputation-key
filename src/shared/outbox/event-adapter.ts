// Outbox event adapter — converts domain events to identifier-only outbox
// payloads (PRE17A A4 / BQR-2.5).
//
// Pipeline:
// 1. Denylist strip of known content fields (defense in depth, ADR 0030).
// 2. Schema-registry allowlist validation — only registered Zod fields are
//    persisted. Unknown keys are dropped by Zod; missing required fields throw.
// 3. Unregistered event types do not enter the outbox (tryToOutboxEvent → null).

import type { OutboxEventInsert } from '#/shared/db/schema/outbox.schema'
import type { DomainEvent } from '#/shared/events/events'
import { isEventRegistered, validateEventPayload } from '#/shared/events/schema-registry'

const PRIMARY_STAFF_ATTRIBUTED_EVENT_TYPES = new Set<string>([
  'guest.qualified_scan.recorded',
  'guest.qualified_scan.retracted',
  'guest.rating.submitted',
  'guest.rating.retracted',
  'guest.feedback.submitted',
  'guest.feedback.retracted',
  'metric.recorded',
  'metric.corrected',
])

const eventVersionFor = (event: DomainEvent): number => {
  if (event._tag === 'guest.scan.recorded' && 'scanSource' in event) return 2
  if (
    (event._tag === 'guest.feedback.submitted' ||
      event._tag === 'guest.feedback.retracted') &&
    'responseRevision' in event
  ) {
    return 3
  }
  if (event._tag === 'integration.google_account.connected') return 3
  return (PRIMARY_STAFF_ATTRIBUTED_EVENT_TYPES.has(event._tag) &&
    'staffAttribution' in event) ||
    event._tag === 'portal.responsibility_became_needed' ||
    event._tag === 'portal.responsible_managers.updated' ||
    event._tag === 'portal.content_review.completed' ||
    event._tag === 'portal.configuration_completeness.recorded' ||
    event._tag === 'portal.approved_destination_ratio.recorded' ||
    event._tag === 'portal_group.deleted' ||
    event._tag === 'review.reply.publication_requested'
    ? 2
    : 1
}

/**
 * Content fields that must NEVER appear in outbox payloads (ADR 0030).
 * These carry review text, reviewer identity, reply content, or other
 * sensitive/provider data. Consumers re-fetch via lookup ports.
 * Denylist is defense-in-depth; the schema registry is the allowlist authority.
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

export type OutboxPayloadErrorCode = 'unregistered' | 'invalid_payload'

/** Thrown when an event cannot be written to the durable outbox. */
export class OutboxPayloadError extends Error {
  readonly code: OutboxPayloadErrorCode

  constructor(code: OutboxPayloadErrorCode, message: string) {
    super(message)
    this.name = 'OutboxPayloadError'
    this.code = code
  }
}

/**
 * Convert a domain event to an outbox insert row.
 * Strips content fields, then allowlist-validates via the event schema registry.
 * Throws OutboxPayloadError if unregistered or invalid.
 */
export function toOutboxEvent(event: DomainEvent): Omit<OutboxEventInsert, 'id'> {
  const eventType = event._tag
  const eventVersion = eventVersionFor(event)

  if (!isEventRegistered(eventType, eventVersion)) {
    throw new OutboxPayloadError(
      'unregistered',
      `Event type ${eventType}:v${eventVersion} is not registered for the outbox. ` +
        'Register an identifier-only Zod schema or stop emitting to the outbox.',
    )
  }

  const stripped = stripContentFields(event)
  // `reason` is normally content and remains denylisted. Portal Health is the
  // sole safe exception: its registered schema accepts only Portal-owned enum
  // codes needed by recovery routing, never manager or provider text.
  if (event._tag === 'portal.health.changed') {
    stripped.reason = event.reason
  }
  const candidate = normalizePayloadValues(stripped)

  let payload: unknown
  try {
    // Zod object schemas strip unknown keys → allowlist-only payload stored.
    payload = validateEventPayload(eventType, eventVersion, candidate)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new OutboxPayloadError(
      'invalid_payload',
      `Outbox payload failed schema allowlist for ${eventType}:v${eventVersion}: ${detail}`,
    )
  }

  // BQC-3.7: re-attach correlationId AFTER allowlist validation. It is an
  // identifier (envelope-grade trace metadata), not content — attaching it
  // post-validation preserves it without touching 30+ identifier-only
  // schemas. Dispatcher-side validation runs the same Zod allowlist, whose
  // object schemas strip unknown keys by default (never reject them), so the
  // re-attached key is inert there and flows into the relay envelope.
  const enrichedPayload = {
    ...(payload as Record<string, unknown>),
    correlationId:
      'correlationId' in event && typeof event.correlationId === 'string'
        ? event.correlationId
        : null,
  }

  const sourceContext = eventType.split('.')[0] ?? eventType
  const organizationId = (
    'organizationId' in event ? String(event.organizationId) : ''
  ) as string
  const propertyId =
    'propertyId' in event && event.propertyId != null ? String(event.propertyId) : null
  const sourceAggregateId = extractAggregateId(event)

  return {
    eventType,
    eventVersion,
    payload: enrichedPayload,
    organizationId,
    propertyId,
    sourceContext,
    sourceAggregateId,
    createdAt: new Date(),
  }
}

/**
 * Like toOutboxEvent, but returns null for unregistered types (expand-phase
 * orphans still emit on the bus without polluting the durable outbox).
 * Still throws on invalid_payload for registered types.
 */
export function tryToOutboxEvent(
  event: DomainEvent,
): Omit<OutboxEventInsert, 'id'> | null {
  try {
    return toOutboxEvent(event)
  } catch (err) {
    if (err instanceof OutboxPayloadError && err.code === 'unregistered') {
      return null
    }
    throw err
  }
}

function stripContentFields(event: DomainEvent): Record<string, unknown> {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (value instanceof Date || value === null || typeof value !== 'object') {
      return value
    }
    const payload: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (!CONTENT_FIELDS_TO_STRIP.has(key)) payload[key] = strip(nested)
    }
    return payload
  }
  return strip(event) as Record<string, unknown>
}

/** Coerce Dates and branded values so Zod string/number schemas can parse. */
function normalizePayloadValues(raw: Record<string, unknown>): Record<string, unknown> {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) {
      return value.toISOString()
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      return value
    }
    if (Array.isArray(value)) return value.map(normalize)
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, normalize(nested)]),
      )
    }
    return value
  }
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, normalize(value)]),
  )
}

/**
 * Try to extract the primary aggregate ID from an event.
 * Checks common field names in priority order.
 */
function extractAggregateId(event: DomainEvent): string {
  const candidates = [
    'reviewId',
    'runId',
    'replyId',
    'inboxItemId',
    'monthlyResultId',
    'noteId',
    'scheduleId',
    'uploadId',
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
    'closureLineageId',
  ] as const

  for (const field of candidates) {
    if (field in event && event[field as keyof DomainEvent] != null) {
      return String(event[field as keyof DomainEvent])
    }
  }

  return event.eventId
}
