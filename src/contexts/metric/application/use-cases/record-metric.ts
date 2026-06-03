// Metric context — record-metric use case
// Validates metric key against known definitions, inserts a raw reading.
// Per architecture: "Dependencies are passed as function arguments."

import type { MetricKey, MetricReading } from '../../domain/types'
import type { MetricRepository } from '../ports/metric.repository'
import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'
import type { EventBus } from '#/shared/events/event-bus'
import { metricError } from '../../domain/errors'
import { metricRecorded } from '../../domain/events'

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
  groupId: PortalGroupId | null
}>

export type RecordMetricDeps = Readonly<{
  metricRepo: MetricRepository
  events: EventBus
  clock: () => Date
}>
export type RecordMetric = ReturnType<typeof recordMetric>

export const recordMetric =
  (deps: RecordMetricDeps) =>
  async (input: RecordMetricInput): Promise<MetricReading> => {
    if (!BUILT_IN_METRIC_KEYS.has(input.metricKey)) {
      throw metricError('unknown_metric_key', `Unknown metric key: ${input.metricKey}`)
    }

    const reading = await deps.metricRepo.insertReading({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      metricKey: input.metricKey,
      value: input.value,
      groupId: input.groupId,
      occurredAt: deps.clock(),
    })

    await deps.events.emit(
      metricRecorded({
        readingId: reading.id,
        organizationId: reading.organizationId,
        propertyId: reading.propertyId,
        portalId: reading.portalId,
        groupId: reading.groupId,
        metricKey: reading.metricKey,
        value: reading.value,
        occurredAt: reading.occurredAt,
      }),
    )

    return reading
  }
