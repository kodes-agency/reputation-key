import type {
  PortalApprovedDestinationRatioRecorded,
  PortalConfigurationCompletenessRecorded,
  PortalContentReviewCompleted,
} from '#/contexts/portal/application/public-api'
import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type {
  RecordMetric,
  RecordMetricInput,
} from '../../application/use-cases/record-metric'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'

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
