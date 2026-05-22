// Metric context — record-metric use case
// Validates metric key against known definitions, inserts a raw reading.
// Per architecture: "Dependencies are passed as function arguments."

import type { MetricKey, MetricReading } from '../../domain/types'
import type { MetricRepository } from '../ports/metric.repository'
import type { OrganizationId, PropertyId, PortalId, StaffId } from '#/shared/domain/ids'
import { metricError } from '../../domain/errors'

const BUILT_IN_METRIC_KEYS: Set<MetricKey> = new Set([
  'portal.scan',
  'portal.rating',
  'portal.feedback',
  'portal.review_link_click',
  'property.review',
])

export type RecordMetricInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  metricKey: MetricKey
  value: number
  staffId: StaffId | null
}>

export type RecordMetricDeps = Readonly<{
  metricRepo: MetricRepository
  clock: () => Date
}>

export const recordMetric =
  (deps: RecordMetricDeps) =>
  async (input: RecordMetricInput): Promise<MetricReading> => {
    if (!BUILT_IN_METRIC_KEYS.has(input.metricKey)) {
      throw metricError('unknown_metric_key', `Unknown metric key: ${input.metricKey}`)
    }

    return deps.metricRepo.insertReading({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      metricKey: input.metricKey,
      value: input.value,
      staffId: input.staffId,
      recordedAt: deps.clock(),
    })
  }
