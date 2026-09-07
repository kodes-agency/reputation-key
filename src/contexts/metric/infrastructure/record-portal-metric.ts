// Metric context — durable Guest fact projections into governed Portal metrics.

import type {
  GuestFeedbackRetracted,
  GuestFeedbackSubmitted,
  GuestQualifiedScanRecorded,
  GuestQualifiedScanRetracted,
  GuestRatingRetracted,
  GuestRatingSubmitted,
  GuestReviewLinkClicked,
  GuestScanRecorded,
} from '#/contexts/guest/application/public-api'
import type {
  RecordMetricEntryInput,
  RecordMetrics,
} from '../application/use-cases/record-metric'
import type { RetractMetricCommand } from '../application/ports/metric-command-store.port'
import type { RetractMetrics } from '../application/use-cases/retract-metric'
import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { MetricKey } from '#/shared/domain/metric-keys'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import { trace } from '#/shared/observability/trace'
import type { AttributionQuality } from '../domain/attribution-quality'
import type { ReadingResult } from '../domain/metric-reading'
import { METRIC_VERSION_IDS, type SourcePolicyClass } from '../domain/metric-registry'
import type { PortalDestinationKind } from '../domain/portal-lifetime-aggregate'

/** Common shape of Guest facts that record a Portal metric. */
export type PortalMetricEvent = Readonly<{
  _tag: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  eventId: string
  supersedesSourceEventId?: string | null
  occurredAt: Date
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
}>

export type RecordPortalMetricDeps = Readonly<{
  recordMetrics: RecordMetrics
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
    asOf: Date,
  ) => Promise<{ portalGroupId: PortalGroupId } | null>
  logger: Pick<LoggerPort, 'warn'>
}>

export type PortalMetricHandlerOptions<E extends PortalMetricEvent> = Readonly<{
  metricKey: MetricKey
  definitionVersionId: string
  sourcePolicy: SourcePolicyClass
  span: string
  value?: (event: E) => number
  /** Producer-owned event-time attribution must not be recomputed during replay. */
  portalGroupId?: (event: E) => PortalGroupId | null
  destinationKind?: (event: E) => PortalDestinationKind
  /** Consumer receipt to commit with this source reading. */
  sourceReceiptConsumer?: string
}>

async function recordPortalMetrics<E extends PortalMetricEvent>(
  options: readonly PortalMetricHandlerOptions<E>[],
  deps: RecordPortalMetricDeps,
  event: E,
): Promise<void> {
  let portalGroupId: PortalGroupId | null = null
  // Portal facts carry portalId, so tenant/Portal attribution is exact. Group
  // membership is enrichment; lookup failure must not discard the reading.
  const attributionQuality: AttributionQuality = 'exact'
  const capturedGroup = options[0]?.portalGroupId
  if (capturedGroup) {
    portalGroupId = capturedGroup(event)
  } else if (event.portalId) {
    try {
      portalGroupId =
        (
          await deps.findGroupForPortal(
            event.organizationId,
            event.portalId,
            event.occurredAt,
          )
        )?.portalGroupId ?? null
    } catch (err) {
      deps.logger.warn(
        { err, event: event._tag, metricKeys: options.map((item) => item.metricKey) },
        'metric: portal-group lookup failed — recording Portal metrics with a null group',
      )
    }
  }

  const sourceReceiptConsumer = options[0]?.sourceReceiptConsumer
  if (options.some((option) => option.sourceReceiptConsumer !== sourceReceiptConsumer)) {
    throw new Error('Portal metric fanout has inconsistent receipt consumers')
  }

  const readings: RecordMetricEntryInput[] = options.map((opts) => ({
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    portalId: event.portalId,
    portalGroupId,
    definitionVersionId: opts.definitionVersionId,
    sourceEventId: event.eventId,
    ...(event.supersedesSourceEventId
      ? { supersedesSourceEventId: event.supersedesSourceEventId }
      : {}),
    sourcePolicy: opts.sourcePolicy,
    scope: 'portal',
    value: opts.value ? opts.value(event) : 1,
    sampleCount: 1,
    occurredAt: event.occurredAt,
    attributionQuality,
    staffAttribution: event.staffAttribution ?? null,
    ...(opts.destinationKind ? { destinationKind: opts.destinationKind(event) } : {}),
  }))

  const results: readonly ReadingResult[] = await deps.recordMetrics({
    readings,
    ...(sourceReceiptConsumer
      ? {
          sourceReceipt: {
            eventId: event.eventId,
            consumerName: sourceReceiptConsumer,
          },
        }
      : {}),
  })
  if (
    results.some(
      (result) =>
        result.status === 'rejected' &&
        result.reason === 'superseded_reading_not_found',
    )
  ) {
    // Ordered retry must converge before the delivery receipt is accepted.
    throw new Error('superseded metric source reading is not available')
  }
}

/** Persistence failures propagate so durable delivery can retry. */
export function makeDurableRecordMetricHandler<E extends PortalMetricEvent>(
  options: PortalMetricHandlerOptions<E>,
) {
  return makeDurableRecordMetricFanoutHandler([options])
}

function makeDurableRecordMetricFanoutHandler<E extends PortalMetricEvent>(
  options: readonly PortalMetricHandlerOptions<E>[],
) {
  return (deps: RecordPortalMetricDeps) =>
    async (event: E): Promise<void> =>
      trace(`${options[0]?.span ?? 'metric.event.portalMetricFanout'}.durable`, () =>
        recordPortalMetrics(options, deps, event),
      )
}

export type PortalMetricRetractionEvent = Readonly<{
  _tag: string
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  supersedesSourceEventId: string
  occurredAt: Date
  staffAttribution?: PrimaryStaffAttributionSnapshot | null
}>

export type RetractPortalMetricDeps = Readonly<{
  retractMetrics: RetractMetrics
}>

type RetractionOption = Readonly<{
  definitionVersionId: string
  span: string
  sourceReceiptConsumer?: string
}>

async function retractPortalMetrics(
  options: readonly RetractionOption[],
  deps: RetractPortalMetricDeps,
  event: PortalMetricRetractionEvent,
): Promise<void> {
  const sourceReceiptConsumer = options[0]?.sourceReceiptConsumer
  if (options.some((option) => option.sourceReceiptConsumer !== sourceReceiptConsumer)) {
    throw new Error('Portal metric retraction has inconsistent receipt consumers')
  }

  const commands: RetractMetricCommand[] = options.map((option) => ({
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    portalId: event.portalId,
    definitionVersionId: option.definitionVersionId,
    sourceEventId: event.eventId,
    supersedesSourceEventId: event.supersedesSourceEventId,
    occurredAt: event.occurredAt,
    staffAttribution: event.staffAttribution ?? null,
  }))
  const results = await deps.retractMetrics(
    commands,
    sourceReceiptConsumer
      ? {
          eventId: event.eventId,
          consumerName: sourceReceiptConsumer,
        }
      : undefined,
  )
  if (results.some((result) => result.status === 'source_reading_not_found')) {
    throw new Error('metric source reading is not available for retraction')
  }
}

export function makeDurablePortalMetricRetractionHandler<
  E extends PortalMetricRetractionEvent,
>(options: readonly RetractionOption[]) {
  return (deps: RetractPortalMetricDeps) =>
    async (event: E): Promise<void> =>
      trace(`${options[0]?.span ?? 'metric.event.portalMetricRetraction'}.durable`, () =>
        retractPortalMetrics(options, deps, event),
      )
}

const scanOptions = {
  metricKey: 'portal.scan',
  definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
  sourcePolicy: 'review_solicitation_analytics_only',
  span: 'metric.event.onScanRecorded',
  sourceReceiptConsumer: 'metric.guest-analytics',
} as const

const qualifiedScanOptions = {
  metricKey: 'portal.qualified_scan',
  definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
  sourcePolicy: 'first_party_guest_gateway_metric',
  span: 'metric.event.onQualifiedScanRecorded',
  portalGroupId: (event: GuestQualifiedScanRecorded) => event.portalGroupId,
  sourceReceiptConsumer: 'metric.guest-analytics',
} as const

const ratingOptions = [
  {
    metricKey: 'portal.rating',
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    sourcePolicy: 'first_party_guest_private',
    span: 'metric.event.onRatingSubmitted',
    value: (event: GuestRatingSubmitted) => event.value,
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    metricKey: 'portal.rating_count',
    definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
    sourcePolicy: 'first_party_guest_gateway_metric',
    span: 'metric.event.onRatingSubmitted',
    value: () => 1,
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    metricKey: 'portal.rating_average',
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
    sourcePolicy: 'first_party_guest_gateway_metric',
    span: 'metric.event.onRatingSubmitted',
    value: (event: GuestRatingSubmitted) => event.value,
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

const feedbackOptions = {
  metricKey: 'portal.feedback',
  definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
  sourcePolicy: 'first_party_guest_private',
  span: 'metric.event.onFeedbackSubmitted',
  sourceReceiptConsumer: 'metric.guest-analytics',
} as const

const reviewLinkOptions = {
  metricKey: 'portal.review_link_click',
  definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
  sourcePolicy: 'review_solicitation_analytics_only',
  span: 'metric.event.onReviewLinkClicked',
  destinationKind: (event: GuestReviewLinkClicked) => event.destinationKind,
  sourceReceiptConsumer: 'metric.guest-analytics',
} as const

const qualifiedScanRetractionOptions = [
  {
    definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
    span: 'metric.event.onQualifiedScanRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

const ratingRetractionOptions = [
  {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    span: 'metric.event.onRatingRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
    span: 'metric.event.onRatingRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
  {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAverageGoal,
    span: 'metric.event.onRatingRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

const feedbackRetractionOptions = [
  {
    definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
    span: 'metric.event.onFeedbackRetracted',
    sourceReceiptConsumer: 'metric.guest-analytics',
  },
] as const

export const onScanRecordedDurably =
  makeDurableRecordMetricHandler<GuestScanRecorded>(scanOptions)
export const onQualifiedScanRecordedDurably =
  makeDurableRecordMetricHandler<GuestQualifiedScanRecorded>(qualifiedScanOptions)
export const onRatingSubmittedDurably =
  makeDurableRecordMetricFanoutHandler<GuestRatingSubmitted>(ratingOptions)
export const onFeedbackSubmittedDurably =
  makeDurableRecordMetricHandler<GuestFeedbackSubmitted>(feedbackOptions)
export const onReviewLinkClickedDurably =
  makeDurableRecordMetricHandler<GuestReviewLinkClicked>(reviewLinkOptions)
export const onQualifiedScanRetractedDurably =
  makeDurablePortalMetricRetractionHandler<GuestQualifiedScanRetracted>(
    qualifiedScanRetractionOptions,
  )
export const onRatingRetractedDurably =
  makeDurablePortalMetricRetractionHandler<GuestRatingRetracted>(ratingRetractionOptions)
export const onFeedbackRetractedDurably =
  makeDurablePortalMetricRetractionHandler<GuestFeedbackRetracted>(
    feedbackRetractionOptions,
  )
