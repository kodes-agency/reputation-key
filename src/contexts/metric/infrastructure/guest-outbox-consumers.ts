import type {
  GuestFeedbackSubmitted,
  GuestFeedbackRetracted,
  GuestQualifiedScanRecorded,
  GuestQualifiedScanRetracted,
  GuestRatingSubmitted,
  GuestRatingRetracted,
  GuestReviewLinkClicked,
  GuestScanRecorded,
} from '#/contexts/guest/application/public-api'
import {
  feedbackId,
  organizationId,
  portalAccessArtifactId,
  portalGroupId,
  portalId,
  portalLinkId,
  propertyId,
  qualifiedScanId,
  ratingId,
  scanEventId,
} from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { registerConsumer, type ConsumerEvent } from '#/shared/outbox'
import { onFeedbackSubmittedDurably } from './event-handlers/on-feedback-submitted'
import { onRatingSubmittedDurably } from './event-handlers/on-rating-submitted'
import { onReviewLinkClickedDurably } from './event-handlers/on-review-link-clicked'
import { onScanRecordedDurably } from './event-handlers/on-scan-recorded'
import { onQualifiedScanRecordedDurably } from './event-handlers/on-qualified-scan-recorded'
import { onQualifiedScanRetractedDurably } from './event-handlers/on-qualified-scan-retracted'
import type { RecordPortalMetricDeps } from './event-handlers/record-portal-metric'
import { onRatingRetractedDurably } from './event-handlers/on-rating-retracted'
import { onFeedbackRetractedDurably } from './event-handlers/on-feedback-retracted'
import type { RetractPortalMetricDeps } from './event-handlers/retract-portal-metric'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'

type GuestMetricPayload = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  occurredAt: string
  scanId?: string
  qualifiedScanId?: string
  portalGroupId?: string | null
  accessArtifactId?: string
  scanSource?: 'qr' | 'nfc' | 'direct'
  /** Retained only for replaying guest.scan.recorded:v1. */
  source?: 'qr' | 'nfc' | 'direct'
  ratingId?: string | null
  value?: number
  supersedesSourceEventId?: string
  feedbackId?: string
  linkId?: string
  destinationKind?: 'google_review' | 'secondary_link'
  staffAttribution?: Readonly<{
    staffParticipantId: string
    staffParticipationId: string
    portalResponsibilityId: string
    effectiveFrom: string
    effectiveTo: string | null
  }> | null
}>

function parseStaffAttribution(
  value: GuestMetricPayload['staffAttribution'],
): PrimaryStaffAttributionSnapshot | null {
  if (!value) return null
  const effectiveFrom = new Date(value.effectiveFrom)
  const effectiveTo = value.effectiveTo ? new Date(value.effectiveTo) : null
  if (
    Number.isNaN(effectiveFrom.getTime()) ||
    (effectiveTo !== null &&
      (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom))
  ) {
    throw new Error('Guest metric Staff attribution interval is invalid')
  }
  return { ...value, effectiveFrom, effectiveTo }
}

function guestMetricDomainEvent(
  event: ConsumerEvent,
):
  | GuestScanRecorded
  | GuestQualifiedScanRecorded
  | GuestQualifiedScanRetracted
  | GuestRatingSubmitted
  | GuestRatingRetracted
  | GuestFeedbackSubmitted
  | GuestFeedbackRetracted
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
    staffAttribution: parseStaffAttribution(payload.staffAttribution),
  }

  switch (event.eventType) {
    case 'guest.scan.recorded': {
      const scanSource = event.eventVersion === 1 ? payload.source : payload.scanSource
      if (!payload.scanId || !scanSource) {
        throw new Error('Guest scan payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        scanId: scanEventId(payload.scanId),
        scanSource,
      }
    }
    case 'guest.qualified_scan.recorded':
      if (!payload.qualifiedScanId || !payload.accessArtifactId) {
        throw new Error('Guest Qualified Scan payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        qualifiedScanId: qualifiedScanId(payload.qualifiedScanId),
        portalGroupId: payload.portalGroupId
          ? portalGroupId(payload.portalGroupId)
          : null,
        accessArtifactId: portalAccessArtifactId(payload.accessArtifactId),
      }
    case 'guest.qualified_scan.retracted':
      if (
        !payload.qualifiedScanId ||
        !payload.accessArtifactId ||
        !payload.supersedesSourceEventId
      ) {
        throw new Error('Guest Qualified Scan retraction payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        qualifiedScanId: qualifiedScanId(payload.qualifiedScanId),
        portalGroupId: payload.portalGroupId
          ? portalGroupId(payload.portalGroupId)
          : null,
        accessArtifactId: portalAccessArtifactId(payload.accessArtifactId),
        supersedesSourceEventId: payload.supersedesSourceEventId,
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
        supersedesSourceEventId: payload.supersedesSourceEventId ?? null,
      }
    case 'guest.rating.retracted':
      if (!payload.ratingId || !payload.supersedesSourceEventId) {
        throw new Error('Guest rating retraction payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        ratingId: ratingId(payload.ratingId),
        supersedesSourceEventId: payload.supersedesSourceEventId,
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
    case 'guest.feedback.retracted':
      if (!payload.feedbackId || !payload.supersedesSourceEventId) {
        throw new Error('Guest feedback retraction payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        feedbackId: feedbackId(payload.feedbackId),
        supersedesSourceEventId: payload.supersedesSourceEventId,
      }
    case 'guest.review_link.clicked':
      if (!payload.linkId) {
        throw new Error('Guest review-link click payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        linkId: portalLinkId(payload.linkId),
        destinationKind:
          payload.destinationKind === 'google_review'
            ? 'google_review'
            : 'secondary_link',
      }
    default:
      throw new Error(`unsupported Guest metric event type: ${event.eventType}`)
  }
}

export function registerGuestMetricConsumers(
  deps: RecordPortalMetricDeps & RetractPortalMetricDeps,
): void {
  const scanHandler = onScanRecordedDurably(deps)
  const qualifiedScanHandler = onQualifiedScanRecordedDurably(deps)
  const qualifiedScanRetractionHandler = onQualifiedScanRetractedDurably(deps)
  const ratingHandler = onRatingSubmittedDurably(deps)
  const feedbackHandler = onFeedbackSubmittedDurably(deps)
  const ratingRetractionHandler = onRatingRetractedDurably(deps)
  const feedbackRetractionHandler = onFeedbackRetractedDurably(deps)
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
    eventType: 'guest.qualified_scan.recorded',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.qualified_scan.recorded') {
        throw new Error('unexpected Guest metric event')
      }
      await qualifiedScanHandler(domainEvent)
      return { status: 'applied' }
    },
  })
  registerConsumer({
    eventType: 'guest.qualified_scan.retracted',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.qualified_scan.retracted') {
        throw new Error('unexpected Guest metric event')
      }
      await qualifiedScanRetractionHandler(domainEvent)
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
    eventType: 'guest.rating.retracted',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.rating.retracted') {
        throw new Error('unexpected Guest metric event')
      }
      await ratingRetractionHandler(domainEvent)
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
    eventType: 'guest.feedback.retracted',
    consumerName: 'metric.guest-analytics',
    module: 'metric.guest-analytics',
    handler: async (event) => {
      const domainEvent = guestMetricDomainEvent(event)
      if (domainEvent._tag !== 'guest.feedback.retracted') {
        throw new Error('unexpected Guest metric event')
      }
      await feedbackRetractionHandler(domainEvent)
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
