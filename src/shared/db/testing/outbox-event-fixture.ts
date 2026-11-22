// Outbox rows for suites that read the durable event log. Times are explicit:
// a suite's assertions depend on them.

import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema'

export type OutboxEventSeed = Readonly<{
  id: string
  eventType: string
  organizationId: string
  propertyId?: string | null
  sourceContext: string
  sourceAggregateId?: string
  /** Becomes both `createdAt` and `publishedAt`. */
  at: Date
  payload?: Record<string, unknown>
}>

const outboxRow = (seed: OutboxEventSeed): typeof outboxEvents.$inferInsert => ({
  id: seed.id,
  eventType: seed.eventType,
  eventVersion: 1,
  payload: seed.payload ?? {},
  organizationId: seed.organizationId,
  propertyId: seed.propertyId ?? null,
  sourceContext: seed.sourceContext,
  sourceAggregateId: seed.sourceAggregateId ?? seed.id,
  createdAt: seed.at,
  publishedAt: seed.at,
})

export async function seedOutboxEvents(
  db: Database,
  seeds: readonly OutboxEventSeed[],
): Promise<void> {
  await db.insert(outboxEvents).values(seeds.map(outboxRow))
}
