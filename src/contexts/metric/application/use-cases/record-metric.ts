// Metric context — record-metric use case
// Validates metric key against known definitions, inserts a raw reading.
// Per architecture: "Dependencies are passed as function arguments."
// BQC-3.5: the reading + metric.recorded fact commit atomically via the
// metric command store (one transaction, post-commit bus emit).

import type { MetricKey, MetricReading } from '../../domain/types'
import type { MetricCommandStore } from '../ports/metric-command-store.port'
import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
  MetricReadingId,
} from '#/shared/domain/ids'
import { metricError } from '../../domain/errors'
import { metricRecorded } from '../../domain/events'
import { createMetricReading } from '../../domain/constructors'

// F073: Use the shared METRIC_KEYS constant instead of duplicating values.
// If a new MetricKey is added to the union, it is automatically valid here.
import { METRIC_KEYS } from '#/shared/domain/metric-keys'
const BUILT_IN_METRIC_KEYS: Set<MetricKey> = new Set(METRIC_KEYS)

export type RecordMetricInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  metricKey: MetricKey
  value: number
  groupId: PortalGroupId | null
}>

export type RecordMetricDeps = Readonly<{
  commandStore: MetricCommandStore
  clock: () => Date
  idGen: () => MetricReadingId
}>
export type RecordMetric = ReturnType<typeof recordMetric>

export const recordMetric =
  (deps: RecordMetricDeps) =>
  async (input: RecordMetricInput): Promise<MetricReading> => {
    if (!BUILT_IN_METRIC_KEYS.has(input.metricKey)) {
      throw metricError('unknown_metric_key', `Unknown metric key: ${input.metricKey}`)
    }

    const reading = createMetricReading({
      id: deps.idGen(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      portalId: input.portalId,
      metricKey: input.metricKey,
      value: input.value,
      groupId: input.groupId,
      occurredAt: deps.clock(),
    })

    // Persist + fact — atomic via the command store (BQC-3.5). The reading id
    // is assigned here so the fact's readingId matches the committed row.
    return deps.commandStore.recordMetric({
      reading,
      event: metricRecorded({
        readingId: reading.id,
        organizationId: reading.organizationId,
        propertyId: reading.propertyId,
        portalId: reading.portalId,
        groupId: reading.groupId,
        metricKey: reading.metricKey,
        value: reading.value,
        occurredAt: reading.occurredAt,
      }),
    })
  }
