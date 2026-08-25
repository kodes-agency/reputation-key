// Metric command store — atomic metric_readings insert + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the metric_readings state write and
// the outbox_events fact in ONE PostgreSQL transaction, then emits on the
// in-process bus after commit (expand-phase dual path until the durable
// switch).

import type { MetricReading, ReadingResult } from '../../domain/metric-reading'
import type { MetricRecorded } from '../../domain/events'
import type { SourcePolicyClass } from '../../domain/metric-registry'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

/**
 * Reading insert + metric.recorded fact in one transaction. The reading id
 * is assigned by the use case (idGen) and inserted explicitly so the fact's
 * readingId always matches the committed row. Returns the committed reading.
 */
export type RecordMetricCommand = Readonly<{
  reading: MetricReading
  supersedesSourceEventId?: string | null
  event: MetricRecorded
}>

export type QuarantineMetricCommand = Readonly<{
  sourceEventId: string
  organizationId: string
  propertyId: string
  definitionVersionId: string | null
  sourcePolicy: SourcePolicyClass
  reason: string
  payloadHash: string
  eventAt: Date
}>

export type RetractMetricCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  definitionVersionId: string
  /** Stable Guest retraction fact id. */
  sourceEventId: string
  /** The currently effective Guest fact whose reading must be retracted. */
  supersedesSourceEventId: string
  occurredAt: Date
}>

export type RetractMetricResult =
  | Readonly<{ status: 'retracted'; correctedReadingId: string }>
  | Readonly<{ status: 'duplicate'; correctedReadingId: string }>
  | Readonly<{ status: 'source_reading_not_found' }>

export type MetricCommandStore = Readonly<{
  recordMetric(command: RecordMetricCommand): Promise<ReadingResult>
  retractMetric(command: RetractMetricCommand): Promise<RetractMetricResult>
  quarantine(command: QuarantineMetricCommand): Promise<void>
}>
