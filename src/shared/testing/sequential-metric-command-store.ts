// Sequential metric command store — NON-transactional test/Storybook fake
// (BQC-3.5). Lives in shared/testing so application-zone tests and browser
// bundles can use it without importing the drizzle-backed atomic store
// (application must not import infrastructure). Applies the same operation
// order (state → outbox → emit) against the repository port without a real
// transaction.
//
// Not for production — production must use createAtomicMetricCommandStore
// (src/contexts/metric/infrastructure/metric-command-store.ts).

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import type { MetricRepository } from '#/contexts/metric/application/ports/metric.repository'
import type { MetricCommandStore } from '#/contexts/metric/application/ports/metric-command-store.port'

/** Post-commit emit, failure-isolated — same contract as the atomic store. */
async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after sequential store state write',
    )
  }
}

export function createSequentialMetricCommandStore(deps: {
  repo: MetricRepository
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): MetricCommandStore {
  return {
    recordMetric: async (command) => {
      const inserted = await deps.repo.insertReading(command.reading)
      if (deps.recordOutbox) await deps.recordOutbox(command.event)
      await emitAfterCommit(deps.events, command.event)
      return inserted
    },
  }
}
