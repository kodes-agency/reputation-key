// Metric context — entity constructors
// Per architecture: "Build domain entities from raw input, composing all validations."
// Constructors throw domain errors on validation failure instead of returning Result.

import type { MetricReading, MetricKey } from './types'
import type {
  MetricReadingId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import { metricError } from './errors'
const VALID_METRIC_KEYS: ReadonlySet<MetricKey> = new Set<MetricKey>([
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
])

type CreateMetricReadingInput = Readonly<{
  id: MetricReadingId
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  metricKey: MetricKey
  value: number
  groupId: PortalGroupId | null
  occurredAt: Date
}>

export const createMetricReading = (input: CreateMetricReadingInput): MetricReading => {
  // value >= 0
  if (input.value < 0) {
    throw metricError('invalid_value', `Metric value must be >= 0, got ${input.value}`)
  }

  // Required IDs present
  if (!input.id) {
    throw metricError('missing_required_field', 'id is required')
  }
  if (!input.organizationId) {
    throw metricError('missing_required_field', 'organizationId is required')
  }
  if (!input.propertyId) {
    throw metricError('missing_required_field', 'propertyId is required')
  }

  // metricKey must be from the allowed set
  if (!VALID_METRIC_KEYS.has(input.metricKey)) {
    throw metricError(
      'invalid_metric_key',
      `Invalid metricKey: ${input.metricKey as string}`,
    )
  }

  return {
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    metricKey: input.metricKey,
    value: input.value,
    groupId: input.groupId,
    occurredAt: input.occurredAt,
  }
}
