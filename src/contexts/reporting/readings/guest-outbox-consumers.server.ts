import type {
  GuestFeedbackSubmitted,
  GuestFeedbackRetracted,
  GuestQualifiedScanRecorded,
  GuestQualifiedScanRetracted,
  GuestRatingSubmitted,
  GuestRatingRetracted,
  GuestReviewLinkClicked,
  GuestScanRecorded,
} from '#/contexts/guest/public-api'
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
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import {
  GUEST_METRIC_CONSUMER,
  onFeedbackRetractedDurably,
  onFeedbackSubmittedDurably,
  onQualifiedScanRecordedDurably,
  onQualifiedScanRetractedDurably,
  onRatingRetractedDurably,
  onRatingSubmittedDurably,
  onReviewLinkClickedDurably,
  onScanRecordedDurably,
  type RecordPortalMetricDeps,
  type RetractPortalMetricDeps,
} from './record-portal-metric.server'
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

type GuestMetricCommon = Omit<GuestScanRecorded, '_tag' | 'scanId' | 'scanSource'> & {
  staffAttribution: PrimaryStaffAttributionSnapshot | null
}

function parseScanRecorded(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
  eventVersion: number,
): GuestScanRecorded {
  const scanSource = eventVersion === 1 ? payload.source : payload.scanSource
  if (!payload.scanId || !scanSource) {
    throw new Error('Guest scan payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.scan.recorded',
    scanId: scanEventId(payload.scanId),
    scanSource,
  }
}

function parseQualifiedScanRecorded(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestQualifiedScanRecorded {
  if (!payload.qualifiedScanId || !payload.accessArtifactId) {
    throw new Error('Guest Qualified Scan payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.qualified_scan.recorded',
    qualifiedScanId: qualifiedScanId(payload.qualifiedScanId),
    portalGroupId: payload.portalGroupId ? portalGroupId(payload.portalGroupId) : null,
    accessArtifactId: portalAccessArtifactId(payload.accessArtifactId),
  }
}

function parseQualifiedScanRetracted(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestQualifiedScanRetracted {
  if (
    !payload.qualifiedScanId ||
    !payload.accessArtifactId ||
    !payload.supersedesSourceEventId
  ) {
    throw new Error('Guest Qualified Scan retraction payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.qualified_scan.retracted',
    qualifiedScanId: qualifiedScanId(payload.qualifiedScanId),
    portalGroupId: payload.portalGroupId ? portalGroupId(payload.portalGroupId) : null,
    accessArtifactId: portalAccessArtifactId(payload.accessArtifactId),
    supersedesSourceEventId: payload.supersedesSourceEventId,
  }
}

function parseRatingSubmitted(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestRatingSubmitted {
  if (!payload.ratingId || typeof payload.value !== 'number') {
    throw new Error('Guest rating payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.rating.submitted',
    ratingId: ratingId(payload.ratingId),
    value: payload.value,
    supersedesSourceEventId: payload.supersedesSourceEventId ?? null,
  }
}

function parseRatingRetracted(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestRatingRetracted {
  if (!payload.ratingId || !payload.supersedesSourceEventId) {
    throw new Error('Guest rating retraction payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.rating.retracted',
    ratingId: ratingId(payload.ratingId),
    supersedesSourceEventId: payload.supersedesSourceEventId,
  }
}

function parseFeedbackSubmitted(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestFeedbackSubmitted {
  if (!payload.feedbackId) {
    throw new Error('Guest feedback payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.feedback.submitted',
    feedbackId: feedbackId(payload.feedbackId),
    ratingId: payload.ratingId ? ratingId(payload.ratingId) : null,
  }
}

function parseFeedbackRetracted(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestFeedbackRetracted {
  if (!payload.feedbackId || !payload.supersedesSourceEventId) {
    throw new Error('Guest feedback retraction payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.feedback.retracted',
    feedbackId: feedbackId(payload.feedbackId),
    supersedesSourceEventId: payload.supersedesSourceEventId,
  }
}

function parseReviewLinkClicked(
  payload: GuestMetricPayload,
  common: GuestMetricCommon,
): GuestReviewLinkClicked {
  if (!payload.linkId) {
    throw new Error('Guest review-link click payload is invalid')
  }
  return {
    ...common,
    _tag: 'guest.review_link.clicked',
    linkId: portalLinkId(payload.linkId),
    destinationKind:
      payload.destinationKind === 'google_review' ? 'google_review' : 'secondary_link',
  }
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
    case 'guest.scan.recorded':
      return parseScanRecorded(payload, common, event.eventVersion)
    case 'guest.qualified_scan.recorded':
      return parseQualifiedScanRecorded(payload, common)
    case 'guest.qualified_scan.retracted':
      return parseQualifiedScanRetracted(payload, common)
    case 'guest.rating.submitted':
      return parseRatingSubmitted(payload, common)
    case 'guest.rating.retracted':
      return parseRatingRetracted(payload, common)
    case 'guest.feedback.submitted':
      return parseFeedbackSubmitted(payload, common)
    case 'guest.feedback.retracted':
      return parseFeedbackRetracted(payload, common)
    case 'guest.review_link.clicked':
      return parseReviewLinkClicked(payload, common)
    default:
      throw new Error(`unsupported Guest metric event type: ${event.eventType}`)
  }
}

type GuestMetricDomainEvent = ReturnType<typeof guestMetricDomainEvent>

/** One entry per event type; the parser's switch guarantees the event matches its handler. */
function metricHandler<E extends GuestMetricDomainEvent>(
  eventType: string,
  handle: (event: E) => Promise<void>,
) {
  return [
    eventType,
    async (event: ConsumerEvent) => {
      await handle(guestMetricDomainEvent(event) as E)
    },
  ] as const
}

export function registerGuestMetricConsumers(
  registry: ConsumerRegistry,
  deps: RecordPortalMetricDeps & RetractPortalMetricDeps,
): void {
  const handlers = [
    metricHandler('guest.scan.recorded', onScanRecordedDurably(deps)),
    metricHandler('guest.qualified_scan.recorded', onQualifiedScanRecordedDurably(deps)),
    metricHandler(
      'guest.qualified_scan.retracted',
      onQualifiedScanRetractedDurably(deps),
    ),
    metricHandler('guest.rating.submitted', onRatingSubmittedDurably(deps)),
    metricHandler('guest.rating.retracted', onRatingRetractedDurably(deps)),
    metricHandler('guest.feedback.submitted', onFeedbackSubmittedDurably(deps)),
    metricHandler('guest.feedback.retracted', onFeedbackRetractedDurably(deps)),
    metricHandler('guest.review_link.clicked', onReviewLinkClickedDurably(deps)),
  ]
  for (const [eventType, handle] of handlers) {
    registry.registerConsumer({
      eventType,
      consumerName: GUEST_METRIC_CONSUMER,
      module: GUEST_METRIC_CONSUMER,
      handler: async (event) => {
        await handle(event)
        return { status: 'applied' }
      },
    })
  }
}
