// Metric command store — atomic metric_readings insert + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the metric_readings state write and
// its outbox_events fact in one PostgreSQL transaction.

import type { MetricReading, ReadingResult } from '../../domain/metric-reading'
import type { MetricRecorded } from '../../domain/events'
import type { SourcePolicyClass } from '../../domain/metric-registry'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import type { PortalLifetimeFact } from '../../domain/portal-lifetime-aggregate'

export type MetricSourceReceipt = Readonly<{
  eventId: string
  consumerName: string
}>

/**
 * Reading insert + metric.recorded fact in one transaction. The reading id
 * is assigned by the use case (idGen) and inserted explicitly so the fact's
 * readingId always matches the committed row. Returns the committed reading.
 */
export type RecordMetricCommand = Readonly<{
  reading: MetricReading
  supersedesSourceEventId?: string | null
  portalLifetimeFact?: PortalLifetimeFact | null
  event: MetricRecorded
  /** Optional source-consumer receipt committed with the reading. */
  sourceReceipt?: MetricSourceReceipt
}>

export type RecordMetricEntry = Omit<RecordMetricCommand, 'sourceReceipt'>

export type RecordMetricsCommand = Readonly<{
  readings: readonly RecordMetricEntry[]
  sourceReceipt?: MetricSourceReceipt
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
  staffAttribution: PrimaryStaffAttributionSnapshot | null
  /** Source-consumer settlement committed atomically with all corrections. */
  sourceReceipt?: MetricSourceReceipt
}>

export type RetractMetricResult =
  | Readonly<{ status: 'retracted'; correctedReadingId: string }>
  | Readonly<{ status: 'duplicate'; correctedReadingId: string }>
  | Readonly<{ status: 'source_reading_not_found' }>

export type MetricCommandStore = Readonly<{
  recordMetrics(command: RecordMetricsCommand): Promise<readonly ReadingResult[]>
  recordMetric(command: RecordMetricCommand): Promise<ReadingResult>
  retractMetrics(
    commands: readonly RetractMetricCommand[],
    sourceReceipt?: MetricSourceReceipt,
  ): Promise<readonly RetractMetricResult[]>
  retractMetric(command: RetractMetricCommand): Promise<RetractMetricResult>
  quarantine(command: QuarantineMetricCommand): Promise<void>
}>
