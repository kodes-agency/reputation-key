// Metric context — entity constructors
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."

import type { MetricReading, MetricKey } from './types'
import type {
  MetricReadingId,
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import { ok, err, type Result } from 'neverthrow'
import { metricError, type MetricError } from './errors'

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

export const createMetricReading = (
  input: CreateMetricReadingInput,
): Result<MetricReading, MetricError> => {
  // value >= 0
  if (input.value < 0) {
    return err(
      metricError('invalid_value', `Metric value must be >= 0, got ${input.value}`),
    )
  }

  // Required IDs present
  if (!input.id) {
    return err(metricError('missing_required_field', 'id is required'))
  }
  if (!input.organizationId) {
    return err(metricError('missing_required_field', 'organizationId is required'))
  }
  if (!input.propertyId) {
    return err(metricError('missing_required_field', 'propertyId is required'))
  }

  return ok({
    id: input.id,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    metricKey: input.metricKey,
    value: input.value,
    groupId: input.groupId,
    occurredAt: input.occurredAt,
  })
}
