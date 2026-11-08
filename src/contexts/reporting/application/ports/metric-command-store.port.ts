import type { MetricReading, ReadingResult } from '../../domain/metric-reading'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { PrimaryStaffAttributionSnapshot } from '#/shared/domain/primary-staff-attribution'
import type { PortalDestinationKind } from '../../domain/portal-link-attribution'

export type MetricSourceReceipt = Readonly<{
  eventId: string
  consumerName: string
}>

/**
 * Commits the reading and source receipt atomically.
 * Replacements also retract the prior reading and emit a correction fact.
 */
export type RecordMetricCommand = Readonly<{
  reading: MetricReading
  supersedesSourceEventId?: string | null
  destinationKind?: PortalDestinationKind | null
  /** Optional source-consumer receipt committed with the reading. */
  sourceReceipt?: MetricSourceReceipt
}>

export type RecordMetricEntry = Omit<RecordMetricCommand, 'sourceReceipt'>

export type RecordMetricsCommand = Readonly<{
  readings: readonly RecordMetricEntry[]
  sourceReceipt?: MetricSourceReceipt
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
  /**
   * Settles a delivery that produced no reading, for a fact the registry
   * refuses by design (a ratio under its minimum sample, a fact that cannot
   * be attributed): the consumer's receipt is committed as processed without
   * effect. A fact lacking a receipt is redelivered and then counted as an
   * exhausted delivery, and only a reading's own commit writes one otherwise.
   * Idempotent: a second call finds the receipt.
   */
  settleSourceReceipt(receipt: MetricSourceReceipt): Promise<void>
  recordMetrics(command: RecordMetricsCommand): Promise<readonly ReadingResult[]>
  recordMetric(command: RecordMetricCommand): Promise<ReadingResult>
  retractMetrics(
    commands: readonly RetractMetricCommand[],
    sourceReceipt?: MetricSourceReceipt,
  ): Promise<readonly RetractMetricResult[]>
  retractMetric(command: RetractMetricCommand): Promise<RetractMetricResult>
}>
