import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { auditEvents } from '#/shared/db/schema/audit-events.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  operationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../domain/operational-action-history'
import { createOperationalActionHistoryStore } from '../infrastructure/operational-action-history-store'
import {
  copyOperationalHistory,
  countOperationalHistoryToCopy,
} from './copy-operational-history.server'
import { createAuditDeliveryStore } from './deliver.server'
import { auditEventFromFact } from './fact.server'

let lease: TestLease
let db: Database

const ORG = organizationId('history-copy-integration')
const now = new Date('2026-11-16T12:00:00Z')
const day = 24 * 60 * 60 * 1000
const ROLLBACK = Symbol('rollback')

const record = (
  id: string,
  provenanceId: string,
  occurredAt: Date,
): OperationalActionRecord => ({
  id: operationalActionHistoryRecordId(id),
  organizationId: ORG,
  propertyId: propertyId('property-1'),
  actorType: 'user',
  actorId: 'user-1',
  action: 'property.archived',
  outcome: 'succeeded',
  resourceType: 'property',
  resourceId: 'property-1',
  reasonCode: 'manager_requested',
  provenance: {
    kind: 'domain_fact',
    id: provenanceId,
    eventType: 'property.archived',
    eventVersion: 1,
    sourceContext: 'property',
    sourceAggregateId: 'property-1',
  },
  occurredAt,
  recordedAt: new Date(occurredAt.getTime() + 1_000),
})

const inRollback = async (run: (transaction: Database) => Promise<void>) => {
  try {
    await db.transaction(async (transaction) => {
      await run(transaction as unknown as Database)
      throw ROLLBACK
    })
  } catch (error) {
    if (error !== ROLLBACK) throw error
  }
}

const eventsOf = (database: Database) =>
  database.select().from(auditEvents).where(eq(auditEvents.organizationId, ORG))

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await lease.release()
})

describe('copy of Operational Action History into audit_events (PostgreSQL)', () => {
  it('copies records inside the window once, keeps provenance, and leaves older records alone', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      const recent = record(
        '00000000-0000-4000-8000-000000002101',
        'fact-recent',
        new Date(now.getTime() - 10 * day),
      )
      const twinned = record(
        '00000000-0000-4000-8000-000000002102',
        'fact-twinned',
        new Date(now.getTime() - 20 * day),
      )
      const old = record(
        '00000000-0000-4000-8000-000000002103',
        'fact-old',
        new Date(now.getTime() - 400 * day),
      )
      for (const entry of [recent, twinned, old]) await store.append(entry)
      await transaction.insert(auditEvents).values({
        organizationId: ORG,
        propertyId: 'property-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'property.archived',
        outcome: 'succeeded',
        resourceType: 'property',
        resourceId: 'property-1',
        sourceKind: 'domain_fact',
        sourceId: 'fact-twinned',
        sourceEventType: 'property.archived',
        sourceEventVersion: 1,
        sourceContext: 'property',
        sourceAggregateId: 'property-1',
        occurredAt: twinned.occurredAt,
      })

      const before = await countOperationalHistoryToCopy(transaction, now)
      expect(before.unmappable).toBe(0)
      expect(before.toCopy).toBeGreaterThanOrEqual(1)

      expect(await copyOperationalHistory(transaction, { now, batchSize: 1 })).toEqual({
        copied: before.toCopy,
      })
      const events = await eventsOf(transaction)
      expect(events.map((event) => event.sourceId).sort()).toEqual([
        'fact-recent',
        'fact-twinned',
      ])
      expect(events.find((event) => event.sourceId === 'fact-recent')).toMatchObject({
        propertyId: 'property-1',
        actorId: 'user-1',
        action: 'property.archived',
        sourceKind: 'domain_fact',
        sourceEventType: 'property.archived',
        occurredAt: recent.occurredAt,
      })

      expect(await copyOperationalHistory(transaction, { now })).toEqual({ copied: 0 })
      expect(await countOperationalHistoryToCopy(transaction, now)).toEqual({
        toCopy: 0,
        unmappable: 0,
      })
    })
  })
})

describe('audit delivery store (PostgreSQL)', () => {
  it('writes the audit event with its receipt once, and rolls both back without the source fact', async () => {
    await inRollback(async (transaction) => {
      const eventId = '00000000-0000-4000-8000-000000002201'
      await transaction.insert(outboxEvents).values({
        id: eventId,
        eventType: 'property.deleted',
        eventVersion: 1,
        payload: {},
        organizationId: ORG,
        propertyId: 'property-1',
        sourceContext: 'property',
        sourceAggregateId: 'property-1',
      })
      const store = createAuditDeliveryStore(transaction)
      const event = auditEventFromFact({
        eventId,
        eventType: 'property.deleted',
        eventVersion: 1,
        payload: {
          organizationId: ORG,
          propertyId: 'property-1',
          occurredAt: '2026-11-16T10:00:00.000Z',
        },
        organizationId: ORG,
        propertyId: 'property-1',
        sourceContext: 'property',
        sourceAggregateId: 'property-1',
        recordedAt: '2026-11-16T10:00:00.000Z',
        correlationId: null,
      })
      const input = {
        event,
        eventId,
        consumerName: 'activity.operational-action-history',
      }

      await expect(store.applyOnce(input)).resolves.toBe('applied')
      await expect(store.applyOnce(input)).resolves.toBe('duplicate')
      expect(await eventsOf(transaction)).toHaveLength(1)
      expect(
        await transaction
          .select({ status: eventConsumerReceipts.status })
          .from(eventConsumerReceipts)
          .where(eq(eventConsumerReceipts.eventId, eventId)),
      ).toEqual([{ status: 'applied' }])

      const missing = '00000000-0000-4000-8000-000000002202'
      await expect(
        store.applyOnce({
          ...input,
          eventId: missing,
          event: { ...event, sourceId: missing },
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } })
      expect(await eventsOf(transaction)).toHaveLength(1)
    })
  })
})
