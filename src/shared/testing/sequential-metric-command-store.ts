import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import type { MetricReading } from '#/contexts/metric/domain/metric-reading'
import type {
  MetricCommandStore,
  MetricSourceReceipt,
  QuarantineMetricCommand,
  RecordMetricCommand,
  RecordMetricsCommand,
  RetractMetricCommand,
} from '#/contexts/metric/application/ports/metric-command-store.port'

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, correlationId: event.correlationId ?? undefined },
      'in-process emit failed after sequential metric store state write',
    )
  }
}

export function createSequentialMetricCommandStore(deps: {
  insertReading: (reading: MetricReading) => Promise<MetricReading>
  quarantine?: (command: QuarantineMetricCommand) => Promise<void>
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
  recordReceipt?: (receipt: MetricSourceReceipt) => Promise<void>
}): MetricCommandStore {
  const recordMetrics = async (command: RecordMetricsCommand) => {
    const results = []
    for (const entry of command.readings) {
      const inserted = await deps.insertReading(entry.reading)
      if (deps.recordOutbox) await deps.recordOutbox(entry.event)
      results.push({ status: 'recorded' as const, reading: inserted })
    }
    if (command.sourceReceipt && deps.recordReceipt) {
      await deps.recordReceipt(command.sourceReceipt)
    }
    for (const entry of command.readings) {
      await emitAfterCommit(deps.events, entry.event)
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
