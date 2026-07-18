// Atomic metric command store (BQC-3.5).
//
// One PostgreSQL transaction per command: metric_readings insert +
// outbox_events insert. After commit: in-process EventBus emit for
// expand-phase legacy consumers (goal/badge/leaderboard handlers).
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the reading and
//   the outbox row — no state/outbox split is ever observable (the
//   pre-BQC-3.5 use case could lose the fact between the repo write and the
//   separate fact record; and with the schema's recordedAt/occurredAt
//   mismatch the record would have thrown anyway — fixed in place at v1).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).

import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { metricReadings } from '#/shared/db/schema/metric.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import { metricError } from '../domain/errors'
import type { MetricReading } from '../domain/types'
import { readingFromRow } from './repositories/metric.repository'
import type {
  MetricCommandStore,
  RecordMetricCommand,
} from '../application/ports/metric-command-store.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.5: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

export function createAtomicMetricCommandStore(
  db: Database,
  events: EventBus,
): MetricCommandStore {
  return {
    recordMetric: async (command: RecordMetricCommand): Promise<MetricReading> => {
      return trace('metric.commandStore.recordMetric', async () => {
        const inserted = await db.transaction(async (tx) => {
          // Explicit id — the use case assigns it (idGen) and the fact's
          // readingId must match the committed row. (The pre-BQC-3.5 repo
          // relied on defaultRandom and discarded the domain id.)
          const rows = await tx
            .insert(metricReadings)
            .values({
              id: unbrand(command.reading.id),
              organizationId: unbrand(command.reading.organizationId),
              propertyId: unbrand(command.reading.propertyId),
              portalId: command.reading.portalId
                ? unbrand(command.reading.portalId)
                : null,
              metricKey: command.reading.metricKey,
              value: command.reading.value,
              groupId: command.reading.groupId ? unbrand(command.reading.groupId) : null,
              occurredAt: command.reading.occurredAt,
            })
            .returning()
          if (!rows[0]) {
            throw metricError(
              'repo_insert_failed',
              'Metric reading insert failed — no row returned',
            )
          }
          await insertOutboxRow(tx, command.event)
          return rows[0]
        })
        await emitAfterCommit(events, command.event)
        return readingFromRow(inserted)
      })
    },
  }
}
