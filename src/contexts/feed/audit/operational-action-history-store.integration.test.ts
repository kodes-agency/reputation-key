import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  operationalActionHistoryHeads,
  operationalActionHistoryRecords,
} from '#/shared/db/schema/activity.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  operationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../domain/operational-action-history'
import {
  createOperationalActionHistoryStore,
  type ActivityTransaction,
} from './operational-action-history-store.server'

let lease: TestLease
let db: Database

const ORG = organizationId('operational-history-integration')
const PROPERTY = propertyId('property-1')
const ROLLBACK = Symbol('rollback operational history test')

const entry = (
  id: string,
  provenanceId: string,
  occurredAt = new Date('2026-08-28T09:00:00.000Z'),
  actorId: string | null = 'user-1',
): OperationalActionRecord => ({
  id: operationalActionHistoryRecordId(id),
  organizationId: ORG,
  propertyId: PROPERTY,
  actorType: actorId === null ? 'system' : 'user',
  actorId,
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

const access = (
  id: string,
  action:
    | 'operational_history.accessed'
    | 'operational_history.exported' = 'operational_history.accessed',
): OperationalActionRecord => ({
  id: operationalActionHistoryRecordId(id),
  organizationId: ORG,
  propertyId: null,
  actorType: 'user',
  actorId: 'account-admin-1',
  action,
  outcome: 'succeeded',
  resourceType: 'operational_history',
  resourceId: id,
  reasonCode: null,
  provenance: {
    kind: 'history_access',
    id: `access:${id}`,
    eventType: null,
    eventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
  },
  occurredAt: new Date('2026-08-28T12:00:00.000Z'),
  recordedAt: new Date('2026-08-28T12:00:00.000Z'),
})

const sequenceState = async (
  executor: Database | ActivityTransaction,
  tenant: OperationalActionRecord['organizationId'],
) => {
  const result = await executor.execute<{
    last_sequence: string
    covered_count: string
    duplicate_count: string
  }>(sql`
    SELECT coalesce(head.last_sequence, 0)::text AS last_sequence,
           count(record.id)::text AS covered_count,
           (count(record.id) - count(DISTINCT record.sequence))::text AS duplicate_count
    FROM (SELECT ${tenant as string}::varchar AS organization_id) AS scope
    LEFT JOIN operational_action_history_heads AS head
      ON head.organization_id = scope.organization_id
    LEFT JOIN operational_action_history_records AS record
      ON record.organization_id = scope.organization_id
    GROUP BY head.last_sequence
  `)
  const row = result.rows[0]
  return {
    lastSequence: Number(row?.last_sequence ?? 0),
    coveredSequenceCount: Number(row?.covered_count ?? 0),
    duplicateSequenceCount: Number(row?.duplicate_count ?? 0),
  }
}

const inRollback = async (run: (transaction: ActivityTransaction) => Promise<void>) => {
  try {
    await db.transaction(async (transaction) => {
      await run(transaction)
      throw ROLLBACK
    })
  } catch (error) {
    if (error !== ROLLBACK) throw error
  }
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await lease.release()
})

describe('Operational Action History store (real PostgreSQL)', () => {
  it('co-commits a durable history record and receipt, and rolls both back when the source fact is missing', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      const sourceEventId = '00000000-0000-4000-8000-000000001101'
      const record = entry('00000000-0000-4000-8000-000000001102', sourceEventId)
      await transaction.insert(outboxEvents).values({
        id: sourceEventId,
        eventType: 'property.archived',
        eventVersion: 1,
        payload: {},
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'property',
        sourceAggregateId: PROPERTY,
      })

      await expect(
        store.applyOnce({
          record,
          eventId: sourceEventId,
          consumerName: 'activity.operational-action-history',
        }),
      ).resolves.toBe('applied')
      await expect(
        store.applyOnce({
          record,
          eventId: sourceEventId,
          consumerName: 'activity.operational-action-history',
        }),
      ).resolves.toBe('duplicate')

      expect(
        await transaction
          .select({ provenanceId: operationalActionHistoryRecords.provenanceId })
          .from(operationalActionHistoryRecords)
          .where(eq(operationalActionHistoryRecords.provenanceId, sourceEventId)),
      ).toEqual([{ provenanceId: sourceEventId }])
      expect(
        await transaction
          .select({ status: eventConsumerReceipts.status })
          .from(eventConsumerReceipts)
          .where(eq(eventConsumerReceipts.eventId, sourceEventId)),
      ).toEqual([{ status: 'applied' }])

      const missingEventId = '00000000-0000-4000-8000-000000001103'
      await expect(
        store.applyOnce({
          record: entry('00000000-0000-4000-8000-000000001104', missingEventId),
          eventId: missingEventId,
          consumerName: 'activity.operational-action-history',
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } })
      expect(
        await transaction
          .select({ provenanceId: operationalActionHistoryRecords.provenanceId })
          .from(operationalActionHistoryRecords)
          .where(eq(operationalActionHistoryRecords.provenanceId, missingEventId)),
      ).toEqual([])
    })
  })

  it('serializes concurrent tenant appends and rolls back a failed first append without consuming sequence', async () => {
    const concurrentOrganization = organizationId(`operational-history-${randomUUID()}`)
    const store = createOperationalActionHistoryStore(db)
    const forOrganization = (
      id: string,
      provenanceId: string,
    ): OperationalActionRecord => ({
      ...entry(id, provenanceId),
      organizationId: concurrentOrganization,
    })
    const invalid = forOrganization(randomUUID(), 'invalid-first-attempt')
    await expect(
      store.append({
        ...invalid,
        recordedAt: new Date(invalid.occurredAt.getTime() - 1),
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } })

    const outcomes = await Promise.all([
      store.append(forOrganization(randomUUID(), 'concurrent-1')),
      store.append(forOrganization(randomUUID(), 'concurrent-2')),
    ])
    expect(outcomes.map(({ sequence }) => sequence).sort()).toEqual([1, 2])
    await expect(sequenceState(db, concurrentOrganization)).resolves.toMatchObject({
      lastSequence: 2,
      coveredSequenceCount: 2,
      duplicateSequenceCount: 0,
    })
  })

  it('allocates tenant-local sequence atomically, recovers duplicate retries, and blocks core mutation', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      const first = entry('00000000-0000-4000-8000-000000001001', 'event-1')
      await expect(store.append(first)).resolves.toEqual({
        status: 'appended',
        sequence: 1,
      })
      await expect(
        store.append({
          ...first,
          id: operationalActionHistoryRecordId('00000000-0000-4000-8000-000000001099'),
        }),
      ).resolves.toEqual({ status: 'duplicate', sequence: 1 })
      await expect(
        store.append(entry('00000000-0000-4000-8000-000000001002', 'event-2')),
      ).resolves.toEqual({ status: 'appended', sequence: 2 })
      const earlierReplicaClock = entry(
        '00000000-0000-4000-8000-000000001003',
        'event-3',
        new Date('2026-08-28T08:00:00.000Z'),
      )
      await expect(store.append(earlierReplicaClock)).resolves.toEqual({
        status: 'appended',
        sequence: 3,
      })

      await expect(
        transaction.transaction((nested) =>
          nested.execute(sql`
            UPDATE operational_action_history_records
            SET action = 'property.deleted'
            WHERE id = ${first.id as string}
          `),
        ),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/append-only core/u) },
      })
      await expect(
        transaction.transaction((nested) =>
          nested.execute(sql`
            DELETE FROM operational_action_history_records
            WHERE id = ${first.id as string}
          `),
        ),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/append-only core/u) },
      })
      await expect(
        transaction.transaction((nested) =>
          nested.execute(sql`TRUNCATE operational_action_history_records`),
        ),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/append-only core/u) },
      })
      await expect(
        transaction.transaction((nested) =>
          nested
            .update(operationalActionHistoryHeads)
            .set({ lastSequence: 9 })
            .where(eq(operationalActionHistoryHeads.organizationId, ORG)),
        ),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/sequence authority/u) },
      })

      await expect(sequenceState(transaction, ORG)).resolves.toMatchObject({
        lastSequence: 3,
        coveredSequenceCount: 3,
        duplicateSequenceCount: 0,
      })
    })
  })

  it('returns bounded keyset pages and co-commits the access-to-history record', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      await store.append(
        entry(
          '00000000-0000-4000-8000-000000001011',
          'event-11',
          new Date('2026-08-28T09:00:00.000Z'),
        ),
      )
      await store.append(
        entry(
          '00000000-0000-4000-8000-000000001012',
          'event-12',
          new Date('2026-08-28T10:00:00.000Z'),
        ),
      )
      await store.append(
        entry(
          '00000000-0000-4000-8000-000000001013',
          'event-13',
          new Date('2026-08-28T11:00:00.000Z'),
        ),
      )

      const page = await store.readWithAccess({
        query: {
          organizationId: ORG,
          limit: 2,
          observedAt: new Date('2026-08-28T12:00:00.000Z'),
        },
        accessRecord: access('00000000-0000-4000-8000-000000001014'),
      })
      expect(page.items.map(({ provenance }) => provenance.id)).toEqual([
        'event-13',
        'event-12',
      ])
      expect(page.nextCursor).toEqual({
        occurredAt: new Date('2026-08-28T10:00:00.000Z'),
        sequence: 2,
      })
      await expect(sequenceState(transaction, ORG)).resolves.toMatchObject({
        lastSequence: 4,
        coveredSequenceCount: 4,
      })
    })
  })
})
