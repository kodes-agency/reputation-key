import type {
  GuestFeedbackSubmitted,
  GuestRatingSubmitted,
  GuestReviewLinkClicked,
  GuestScanRecorded,
} from '#/contexts/guest/application/public-api'
import {
  feedbackId,
  organizationId,
  portalId,
  portalLinkId,
  propertyId,
  ratingId,
  scanEventId,
} from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { registerConsumer, type ConsumerEvent } from '#/shared/outbox/dispatcher'
import { onFeedbackSubmittedDurably } from './event-handlers/on-feedback-submitted'
import { onRatingSubmittedDurably } from './event-handlers/on-rating-submitted'
import { onReviewLinkClickedDurably } from './event-handlers/on-review-link-clicked'
import { onScanRecordedDurably } from './event-handlers/on-scan-recorded'
import type { RecordPortalMetricDeps } from './event-handlers/record-portal-metric'

type GuestMetricPayload = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  occurredAt: string
  scanId?: string
  source?: 'qr' | 'nfc' | 'direct'
  ratingId?: string | null
  value?: number
  feedbackId?: string
  linkId?: string
}>

function guestMetricDomainEvent(
  event: ConsumerEvent,
):
  | GuestScanRecorded
  | GuestRatingSubmitted
  | GuestFeedbackSubmitted
  | GuestReviewLinkClicked {
  const payload = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  ) as GuestMetricPayload
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Guest metric envelope attribution does not match its payload')
  }
  const occurredAt = new Date(payload.occurredAt)
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error('Guest metric event occurredAt is invalid')
  }
  const common = {
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    portalId: portalId(payload.portalId),
    occurredAt,
  }

  switch (event.eventType) {
    case 'guest.scan.recorded':
      if (!payload.scanId || !payload.source) {
        throw new Error('Guest scan payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        scanId: scanEventId(payload.scanId),
        source: payload.source,
      }
    case 'guest.rating.submitted':
      if (!payload.ratingId || typeof payload.value !== 'number') {
        throw new Error('Guest rating payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        ratingId: ratingId(payload.ratingId),
        value: payload.value,
      }
    case 'guest.feedback.submitted':
      if (!payload.feedbackId) {
        throw new Error('Guest feedback payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        feedbackId: feedbackId(payload.feedbackId),
        ratingId: payload.ratingId ? ratingId(payload.ratingId) : null,
      }
    case 'guest.review_link.clicked':
      if (!payload.linkId) {
        throw new Error('Guest review-link click payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        linkId: portalLinkId(payload.linkId),
      }
    default:
      throw new Error(`unsupported Guest metric event type: ${event.eventType}`)
  }
}

export function registerGuestMetricConsumers(deps: RecordPortalMetricDeps): void {
  const scanHandler = onScanRecordedDurably(deps)
  const ratingHandler = onRatingSubmittedDurably(deps)
  const feedbackHandler = onFeedbackSubmittedDurably(deps)
  const clickHandler = onReviewLinkClickedDurably(deps)

  registerConsumer({
    eventType: 'guest.scan.recorded',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.scan.recorded') {
        throw new Error('unexpected Guest metric event')
      }
      await scanHandler(domainEvent)
      return { status: 'applied' }
    },
  })
  registerConsumer({
    eventType: 'guest.rating.submitted',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.rating.submitted') {
        throw new Error('unexpected Guest metric event')
      }
      await ratingHandler(domainEvent)
      return { status: 'applied' }
    },
  })
  registerConsumer({
    eventType: 'guest.feedback.submitted',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.feedback.submitted') {
        throw new Error('unexpected Guest metric event')
      }
      await feedbackHandler(domainEvent)
      return { status: 'applied' }
    },
  })
  registerConsumer({
    eventType: 'guest.review_link.clicked',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.review_link.clicked') {
        throw new Error('unexpected Guest metric event')
      }
      await clickHandler(domainEvent)
      return { status: 'applied' }
    },
  })
}
