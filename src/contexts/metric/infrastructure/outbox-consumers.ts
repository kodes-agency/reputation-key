import type {
  PortalApprovedDestinationRatioRecorded,
  PortalConfigurationCompletenessRecorded,
  PortalContentReviewCompleted,
} from '#/contexts/portal/application/public-api'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import {
  onApprovedDestinationRatioRecorded,
  onConfigurationCompletenessRecorded,
  onContentReviewCompleted,
  type PortalWorkflowMetricDeps,
} from './event-handlers/on-portal-workflow-metric'

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
