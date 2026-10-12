import type {
  PortalApprovedDestinationRatioRecorded,
  PortalConfigurationCompletenessRecorded,
  PortalContentReviewCompleted,
} from '#/contexts/portal/application/public-api'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type OrganizationId,
  type PortalGroupId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type {
  RecordMetric,
  RecordMetricInput,
} from '../application/use-cases/record-metric'
import type { MetricRepository } from '../application/ports/metric.repository'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'

export type PortalMetricAttribution = Readonly<{
  propertyId: PropertyId
  portalGroupId: PortalGroupId | null
}>

export type PortalWorkflowMetricDeps = Readonly<{
  recordMetric: RecordMetric
  /** Null when the Portal is missing or attributed elsewhere; throws on lookup failure. */
  resolveAttribution: (
    organizationId: OrganizationId,
    portalId: PortalId,
    occurredAt: Date,
  ) => Promise<PortalMetricAttribution | null>
  /** Whether the source event has a reading under this version. */
  hasReading: MetricRepository['hasReading']
}>

type PortalWorkflowEvent =
  | PortalContentReviewCompleted
  | PortalConfigurationCompletenessRecorded
  | PortalApprovedDestinationRatioRecorded

async function buildCommonInput(
  deps: PortalWorkflowMetricDeps,
  event: PortalWorkflowEvent,
): Promise<
  Pick<
    RecordMetricInput,
    | 'organizationId'
    | 'propertyId'
    | 'portalId'
    | 'portalGroupId'
    | 'sourceEventId'
    | 'sourcePolicy'
    | 'scope'
    | 'occurredAt'
    | 'attributionQuality'
    | 'supersedesSourceEventId'
    | 'sourceReceipt'
  >
> {
  // A lookup failure propagates so durable delivery retries the fact (ADR 0040);
  // only a resolved attribution that disagrees with the event is unresolved.
  const resolved = await deps.resolveAttribution(
    event.organizationId,
    event.portalId,
    event.occurredAt,
  )

  const exact =
    resolved !== null &&
    resolved.propertyId === event.propertyId &&
    resolved.portalGroupId === event.portalGroupId

  return {
    organizationId: event.organizationId,
    propertyId: event.propertyId,
    portalId: event.portalId,
    portalGroupId: event.portalGroupId,
    sourceEventId: event.eventId,
    sourcePolicy: 'first_party_workflow',
    scope: event.portalGroupId === null ? 'property' : 'portal_group',
    occurredAt: event.occurredAt,
    attributionQuality: exact ? 'exact' : 'unresolved',
    supersedesSourceEventId: event.supersedesSourceEventId,
    sourceReceipt: {
      eventId: event.eventId,
      consumerName: 'metric.portal-workflow',
    },
  }
}

export const onContentReviewCompleted = (deps: PortalWorkflowMetricDeps) => {
  return async (event: PortalContentReviewCompleted): Promise<void> => {
    const common = await buildCommonInput(deps, event)
    await deps.recordMetric({
      ...common,
      definitionVersionId: METRIC_VERSION_IDS.contentReviewCompleted,
      value: 1,
      sampleCount: 1,
    })
  }
}

/** Each field set counts different fields, so each has its own version (ADR 0041). */
const COMPLETENESS_VERSION_IDS: Readonly<
  Record<PortalConfigurationCompletenessRecorded['fieldSet'], string>
> = {
  legacy: METRIC_VERSION_IDS.configurationCompleteness,
  immersive_hub: METRIC_VERSION_IDS.configurationCompletenessImmersiveHub,
}

/**
 * The reading a completeness correction replaces, when that reading is of the
 * correction's own version. A review counted on one field set and corrected on
 * the other has nothing to replace in the correction's version: the earlier
 * reading keeps its meaning, and the correction starts its own version's
 * series. Passed on, the store would reject it and delivery would retry until
 * its budget ran out.
 */
async function supersededInVersion(
  deps: PortalWorkflowMetricDeps,
  event: PortalConfigurationCompletenessRecorded,
): Promise<string | null> {
  const superseded = event.supersedesSourceEventId
  if (superseded === null) return null
  const otherFieldSet = event.fieldSet === 'legacy' ? 'immersive_hub' : 'legacy'
  const countedOnOtherFields = await deps.hasReading({
    organizationId: event.organizationId,
    definitionVersionId: COMPLETENESS_VERSION_IDS[otherFieldSet],
    sourceEventId: superseded,
  })
  return countedOnOtherFields ? null : superseded
}

export const onConfigurationCompletenessRecorded = (deps: PortalWorkflowMetricDeps) => {
  return async (event: PortalConfigurationCompletenessRecorded): Promise<void> => {
    const common = await buildCommonInput(deps, event)
    await deps.recordMetric({
      ...common,
      supersedesSourceEventId: await supersededInVersion(deps, event),
      definitionVersionId: COMPLETENESS_VERSION_IDS[event.fieldSet],
      value: Number(((event.completedFields / event.requiredFields) * 100).toFixed(2)),
      numerator: event.completedFields,
      denominator: event.requiredFields,
      sampleCount: event.requiredFields,
    })
  }
}

export const onApprovedDestinationRatioRecorded = (deps: PortalWorkflowMetricDeps) => {
  return async (event: PortalApprovedDestinationRatioRecorded): Promise<void> => {
    const common = await buildCommonInput(deps, event)
    await deps.recordMetric({
      ...common,
      definitionVersionId: METRIC_VERSION_IDS.approvedDestinationRatio,
      value:
        event.configuredDestinations === 0
          ? 0
          : Number(
              (event.approvedDestinations / event.configuredDestinations).toFixed(4),
            ),
      numerator: event.approvedDestinations,
      denominator: event.configuredDestinations,
      sampleCount: event.configuredDestinations,
    })
  }
}

type PortalWorkflowPayload = Readonly<{
  reviewId: string
  revision: number
  organizationId: string
  propertyId: string
  portalId: string
  portalGroupId: string | null
  supersedesSourceEventId: string | null
  sourceAggregateVersion?: string
  occurredAt: string
  completedFields?: number
  requiredFields?: number
  fieldSet?: 'immersive_hub'
  approvedDestinations?: number
  configuredDestinations?: number
}>

function fieldSetOf(
  payload: PortalWorkflowPayload,
): PortalConfigurationCompletenessRecorded['fieldSet'] {
  if (payload.fieldSet !== 'immersive_hub') {
    throw new Error('Portal configuration completeness field set is missing')
  }
  return payload.fieldSet
}

function portalWorkflowDomainEvent(
  event: ConsumerEvent,
):
  | PortalContentReviewCompleted
  | PortalConfigurationCompletenessRecorded
  | PortalApprovedDestinationRatioRecorded {
  const validated = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  )
  // validateEventPayload has applied the registered identifier-only Zod schema.
  const payload = validated as PortalWorkflowPayload
  let sourceAggregateVersion: string
  if (event.eventVersion === 1) {
    sourceAggregateVersion = payload.occurredAt
  } else {
    if (!payload.sourceAggregateVersion) {
      throw new Error('Portal workflow aggregate revision is missing')
    }
    sourceAggregateVersion = payload.sourceAggregateVersion
  }
  const common = {
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    reviewId: payload.reviewId,
    revision: payload.revision,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    portalId: portalId(payload.portalId),
    portalGroupId: payload.portalGroupId ? portalGroupId(payload.portalGroupId) : null,
    supersedesSourceEventId: payload.supersedesSourceEventId,
    sourceAggregateVersion,
    occurredAt: new Date(payload.occurredAt),
  }
  if (Number.isNaN(common.occurredAt.getTime())) {
    throw new Error('Portal workflow event occurredAt is invalid')
  }
  switch (event.eventType) {
    case 'portal.content_review.completed':
      return { ...common, _tag: event.eventType }
    case 'portal.configuration_completeness.recorded':
      if (
        typeof payload.completedFields !== 'number' ||
        typeof payload.requiredFields !== 'number'
      ) {
        throw new Error('Portal configuration completeness payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        completedFields: payload.completedFields,
        requiredFields: payload.requiredFields,
        // v1 and v2 facts were all counted on the legacy fields; v3 names its own.
        fieldSet: event.eventVersion >= 3 ? fieldSetOf(payload) : 'legacy',
      }
    case 'portal.approved_destination_ratio.recorded':
      if (
        typeof payload.approvedDestinations !== 'number' ||
        typeof payload.configuredDestinations !== 'number'
      ) {
        throw new Error('Portal destination ratio payload is invalid')
      }
      return {
        ...common,
        _tag: event.eventType,
        approvedDestinations: payload.approvedDestinations,
        configuredDestinations: payload.configuredDestinations,
      }
    default:
      throw new Error(`unsupported Portal workflow event type: ${event.eventType}`)
  }
}

export function registerPortalWorkflowMetricConsumers(
  registry: ConsumerRegistry,
  deps: PortalWorkflowMetricDeps,
): void {
  const { registerConsumer } = registry
  const contentReviewHandler = onContentReviewCompleted(deps)
  const completenessHandler = onConfigurationCompletenessRecorded(deps)
  const ratioHandler = onApprovedDestinationRatioRecorded(deps)

  registerConsumer({
    eventType: 'portal.content_review.completed',
    consumerName: 'metric.portal-workflow',
    module: 'metric.portal-workflow',
    handler: async (event) => {
      const domainEvent = portalWorkflowDomainEvent(event)
      if (domainEvent._tag !== 'portal.content_review.completed') {
        throw new Error('unexpected Portal workflow event')
      }
      await contentReviewHandler(domainEvent)
      return { status: 'applied' }
    },
  })
  registerConsumer({
    eventType: 'portal.configuration_completeness.recorded',
    consumerName: 'metric.portal-workflow',
    module: 'metric.portal-workflow',
    handler: async (event) => {
      const domainEvent = portalWorkflowDomainEvent(event)
      if (domainEvent._tag !== 'portal.configuration_completeness.recorded') {
        throw new Error('unexpected Portal workflow event')
      }
      await completenessHandler(domainEvent)
      return { status: 'applied' }
    },
  })
  registerConsumer({
    eventType: 'portal.approved_destination_ratio.recorded',
    consumerName: 'metric.portal-workflow',
    module: 'metric.portal-workflow',
    handler: async (event) => {
      const domainEvent = portalWorkflowDomainEvent(event)
      if (domainEvent._tag !== 'portal.approved_destination_ratio.recorded') {
        throw new Error('unexpected Portal workflow event')
      }
      await ratioHandler(domainEvent)
      return { status: 'applied' }
    },
  })
}
