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
import { METRIC_VERSION_IDS } from '../domain/metric-registry'

export type PortalMetricAttribution = Readonly<{
  propertyId: PropertyId
  portalGroupId: PortalGroupId | null
}>

export type PortalWorkflowMetricDeps = Readonly<{
  recordMetric: RecordMetric
  resolveAttribution: (
    organizationId: OrganizationId,
    portalId: PortalId,
    occurredAt: Date,
  ) => Promise<PortalMetricAttribution | null>
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
  const resolved = await deps
    .resolveAttribution(event.organizationId, event.portalId, event.occurredAt)
    .catch(() => null)

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

export const onConfigurationCompletenessRecorded = (deps: PortalWorkflowMetricDeps) => {
  return async (event: PortalConfigurationCompletenessRecorded): Promise<void> => {
    const common = await buildCommonInput(deps, event)
    await deps.recordMetric({
      ...common,
      definitionVersionId: METRIC_VERSION_IDS.configurationCompleteness,
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
  approvedDestinations?: number
  configuredDestinations?: number
}>

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
