// Metric command store — atomic metric_readings insert + outbox record
// (BQC-3.5).
//
// Callers must not know Drizzle transaction types or outbox tables.
// The production implementation commits the metric_readings state write and
// the outbox_events fact in ONE PostgreSQL transaction, then emits on the
// in-process bus after commit (expand-phase dual path until the durable
// switch).

import type { MetricReading } from '../../domain/types'
import type { MetricRecorded } from '../../domain/events'

/**
 * Reading insert + metric.recorded fact in one transaction. The reading id
 * is assigned by the use case (idGen) and inserted explicitly so the fact's
 * readingId always matches the committed row. Returns the committed reading.
 */
export type RecordMetricCommand = Readonly<{
  reading: MetricReading
  event: MetricRecorded
}>

export type MetricCommandStore = Readonly<{
  recordMetric(command: RecordMetricCommand): Promise<MetricReading>
}>
