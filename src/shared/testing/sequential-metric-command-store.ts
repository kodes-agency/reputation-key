import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import type { MetricReading } from '#/contexts/metric/domain/metric-reading'
import type {
  MetricCommandStore,
  MetricSourceReceipt,
  QuarantineMetricCommand,
  RecordMetricCommand,
  RecordMetricsCommand,
  RetractMetricCommand,
} from '#/contexts/metric/application/ports/metric-command-store.port'

export function createSequentialMetricCommandStore(deps: {
  insertReading: (reading: MetricReading) => Promise<MetricReading>
  quarantine?: (command: QuarantineMetricCommand) => Promise<void>
  outbox?: RecordedOutbox
  recordReceipt?: (receipt: MetricSourceReceipt) => Promise<void>
}): MetricCommandStore {
  const outbox = deps.outbox ?? createRecordedOutbox()
  const recordMetrics = async (command: RecordMetricsCommand) => {
    const results = []
    for (const entry of command.readings) {
      const inserted = await deps.insertReading(entry.reading)
      await outbox.record(entry.event)
      results.push({ status: 'recorded' as const, reading: inserted })
    }
    if (command.sourceReceipt && deps.recordReceipt) {
      await deps.recordReceipt(command.sourceReceipt)
    }
    return results
  }
  const retractMetrics = async (commands: readonly RetractMetricCommand[]) =>
    commands.map(() => ({ status: 'source_reading_not_found' as const }))

  return {
    recordMetrics,
    recordMetric: async (command: RecordMetricCommand) => {
      const { sourceReceipt, ...reading } = command
      const [result] = await recordMetrics({
        readings: [reading],
        sourceReceipt,
      })
      if (!result) throw new Error('Sequential metric command produced no result')
      return result
    },
    retractMetrics,
    retractMetric: async (command) => {
      const [result] = await retractMetrics([command])
      if (!result) throw new Error('Sequential metric retraction produced no result')
      return result
    },
    quarantine: async (command) => {
      await deps.quarantine?.(command)
    },
  }
}
