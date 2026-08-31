import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import type { MetricReading } from '#/contexts/metric/domain/metric-reading'
import type {
  MetricCommandStore,
  QuarantineMetricCommand,
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
}): MetricCommandStore {
  return {
    recordMetric: async (command) => {
      const inserted = await deps.insertReading(command.reading)
      if (deps.recordOutbox) await deps.recordOutbox(command.event)
      await emitAfterCommit(deps.events, command.event)
      return { status: 'recorded', reading: inserted }
    },
    retractMetric: async () => ({ status: 'source_reading_not_found' }),
    quarantine: async (command) => {
      await deps.quarantine?.(command)
    },
  }
}
