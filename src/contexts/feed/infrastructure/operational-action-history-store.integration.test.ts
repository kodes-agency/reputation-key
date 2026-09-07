import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  operationalActionHistoryHeads,
  operationalActionHistoryLegalHolds,
  operationalActionHistoryRecords,
} from '#/shared/db/schema/activity.schema'
import { eventConsumerReceipts, outboxEvents } from '#/shared/db/schema/outbox.schema'
import {
  operationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../domain/operational-action-history'
import { getOperationalActionHistoryReadiness } from '../application/use-cases/operational-action-history-lifecycle'
import {
  createOperationalActionHistoryStore,
  type ActivityTransaction,
} from './operational-action-history-store'

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

const lifecycle = (
  id: string,
  action:
    | 'operational_history.legal_hold_placed'
    | 'operational_history.legal_hold_released'
    | 'operational_history.redaction_applied'
    | 'operational_history.retention_assessed',
  reasonCode = 'legal_request',
  resourceId = id,
): OperationalActionRecord => ({
  ...access(id),
  actorType: 'operator',
  actorId: 'operator-1',
  action,
  reasonCode,
  resourceId,
  provenance: {
    kind: 'history_lifecycle',
    id: `lifecycle:${id}`,
    eventType: null,
    eventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
  },
})

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
    await expect(store.readReadiness(concurrentOrganization)).resolves.toMatchObject({
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

      await expect(store.readReadiness(ORG)).resolves.toMatchObject({
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
      await expect(store.readReadiness(ORG)).resolves.toMatchObject({
        lastSequence: 4,
        coveredSequenceCount: 4,
      })
    })
  })

  it('prevents redaction under an active hold, then permits identifier-only redaction after release', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      const target = entry('00000000-0000-4000-8000-000000001021', 'event-21')
      await store.append(target)
      const holdId = '00000000-0000-4000-8000-000000001022'
      const hold = {
        id: holdId,
        organizationId: ORG,
        reasonCode: 'legal_request',
        protectsFrom: new Date('2026-01-01T00:00:00.000Z'),
        protectsThrough: null,
        placedAt: new Date('2026-08-28T12:00:00.000Z'),
        placedByActorId: 'operator-1',
      }
      const placedAction = lifecycle(
        '00000000-0000-4000-8000-000000001023',
        'operational_history.legal_hold_placed',
        'legal_request',
        holdId,
      )
      await expect(
        store.placeLegalHold({ hold, actionRecord: placedAction }),
      ).resolves.toEqual({ status: 'placed', holdId })
      await expect(
        store.placeLegalHold({
          hold: {
            ...hold,
            id: '00000000-0000-4000-8000-000000001027',
            placedAt: new Date('2026-08-28T12:01:00.000Z'),
          },
          actionRecord: {
            ...placedAction,
            id: operationalActionHistoryRecordId('00000000-0000-4000-8000-000000001028'),
            resourceId: '00000000-0000-4000-8000-000000001027',
            occurredAt: new Date('2026-08-28T12:01:00.000Z'),
            recordedAt: new Date('2026-08-28T12:01:00.000Z'),
          },
        }),
      ).resolves.toEqual({ status: 'duplicate', holdId })
      await expect(
        transaction.transaction((nested) =>
          nested
            .update(operationalActionHistoryLegalHolds)
            .set({ reasonCode: 'rewritten_reason' })
            .where(eq(operationalActionHistoryLegalHolds.id, holdId)),
        ),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringMatching(/append-only legal-hold evidence/u),
        },
      })
      await expect(
        store.redactSubject({
          organizationId: ORG,
          subjectType: 'actor',
          subjectId: 'user-1',
          reasonCode: 'privacy_request',
          redactedAt: new Date('2026-08-28T12:10:00.000Z'),
          limit: 100,
          actionRecord: lifecycle(
            '00000000-0000-4000-8000-000000001024',
            'operational_history.redaction_applied',
            'privacy_request',
          ),
        }),
      ).resolves.toEqual({
        status: 'applied',
        redacted: 0,
        held: 1,
        complete: false,
      })

      const releasedAction = lifecycle(
        '00000000-0000-4000-8000-000000001025',
        'operational_history.legal_hold_released',
        'legal_request_closed',
        holdId,
      )
      await store.releaseLegalHold({
        organizationId: ORG,
        holdId,
        releasedAt: new Date('2026-08-28T12:20:00.000Z'),
        releasedByActorId: 'operator-1',
        reasonCode: 'legal_request_closed',
        actionRecord: releasedAction,
      })
      await expect(
        store.releaseLegalHold({
          organizationId: ORG,
          holdId,
          releasedAt: new Date('2026-08-28T12:21:00.000Z'),
          releasedByActorId: 'operator-1',
          reasonCode: 'legal_request_closed',
          actionRecord: {
            ...releasedAction,
            id: operationalActionHistoryRecordId('00000000-0000-4000-8000-000000001029'),
            occurredAt: new Date('2026-08-28T12:21:00.000Z'),
            recordedAt: new Date('2026-08-28T12:21:00.000Z'),
          },
        }),
      ).resolves.toBe('duplicate')
      await expect(
        store.redactSubject({
          organizationId: ORG,
          subjectType: 'actor',
          subjectId: 'user-1',
          reasonCode: 'privacy_request',
          redactedAt: new Date('2026-08-28T12:30:00.000Z'),
          limit: 100,
          actionRecord: lifecycle(
            '00000000-0000-4000-8000-000000001026',
            'operational_history.redaction_applied',
            'privacy_request',
          ),
        }),
      ).resolves.toEqual({
        status: 'applied',
        redacted: 1,
        held: 0,
        complete: true,
      })

      expect(
        await transaction
          .select({ actorId: operationalActionHistoryRecords.actorId })
          .from(operationalActionHistoryRecords)
          .where(eq(operationalActionHistoryRecords.id, target.id as string)),
      ).toEqual([{ actorId: null }])
    })
  })

  it('makes a completed redaction correlation a no-op instead of consuming another batch', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      const redactionOrganization = organizationId(
        `operational-history-redaction-${randomUUID()}`,
      )
      const first = {
        ...entry('00000000-0000-4000-8000-000000001051', 'event-51'),
        organizationId: redactionOrganization,
      }
      const second = {
        ...entry('00000000-0000-4000-8000-000000001052', 'event-52'),
        organizationId: redactionOrganization,
      }
      await store.append(first)
      await store.append(second)
      const actionRecord = {
        ...lifecycle(
          '00000000-0000-4000-8000-000000001053',
          'operational_history.redaction_applied',
          'privacy_request',
        ),
        organizationId: redactionOrganization,
      }

      await expect(
        store.redactSubject({
          organizationId: redactionOrganization,
          subjectType: 'actor',
          subjectId: 'user-1',
          reasonCode: 'privacy_request',
          redactedAt: new Date('2026-08-28T12:30:00.000Z'),
          limit: 1,
          actionRecord,
        }),
      ).resolves.toEqual({
        status: 'applied',
        redacted: 1,
        held: 0,
        complete: false,
      })
      await expect(
        store.redactSubject({
          organizationId: redactionOrganization,
          subjectType: 'actor',
          subjectId: 'user-1',
          reasonCode: 'privacy_request',
          redactedAt: new Date('2026-08-28T12:31:00.000Z'),
          limit: 1,
          actionRecord: {
            ...actionRecord,
            id: operationalActionHistoryRecordId('00000000-0000-4000-8000-000000001054'),
            occurredAt: new Date('2026-08-28T12:31:00.000Z'),
            recordedAt: new Date('2026-08-28T12:31:00.000Z'),
          },
        }),
      ).resolves.toEqual({
        status: 'duplicate',
        redacted: 0,
        held: 0,
        complete: false,
      })

      const targetRows = await transaction
        .select({ actorId: operationalActionHistoryRecords.actorId })
        .from(operationalActionHistoryRecords)
        .where(
          inArray(operationalActionHistoryRecords.id, [
            first.id as string,
            second.id as string,
          ]),
        )
      expect(targetRows.filter(({ actorId }) => actorId === null)).toHaveLength(1)
      expect(targetRows.filter(({ actorId }) => actorId === 'user-1')).toHaveLength(1)
    })
  })

  it('assesses held and eligible 365-day records without deleting either', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      const oldHeld = entry(
        '00000000-0000-4000-8000-000000001031',
        'event-31',
        new Date('2025-01-01T00:00:00.000Z'),
      )
      const oldEligible = entry(
        '00000000-0000-4000-8000-000000001032',
        'event-32',
        new Date('2025-02-01T00:00:00.000Z'),
      )
      await store.append(oldHeld)
      await store.append(oldEligible)
      await store.placeLegalHold({
        hold: {
          id: '00000000-0000-4000-8000-000000001033',
          organizationId: ORG,
          reasonCode: 'legal_request',
          protectsFrom: new Date('2024-12-01T00:00:00.000Z'),
          protectsThrough: new Date('2025-01-15T00:00:00.000Z'),
          placedAt: new Date('2026-08-28T12:00:00.000Z'),
          placedByActorId: 'operator-1',
        },
        actionRecord: lifecycle(
          '00000000-0000-4000-8000-000000001034',
          'operational_history.legal_hold_placed',
          'legal_request',
          '00000000-0000-4000-8000-000000001033',
        ),
      })

      await expect(
        store.assessRetention({
          organizationId: ORG,
          cutoff: new Date('2025-08-28T12:00:00.000Z'),
          assessmentRecord: lifecycle(
            '00000000-0000-4000-8000-000000001035',
            'operational_history.retention_assessed',
            'report_only_pending_counsel',
          ),
        }),
      ).resolves.toEqual({
        eligibleCount: 1,
        heldCount: 1,
        oldestEligibleAt: new Date('2025-02-01T00:00:00.000Z'),
      })
      expect(
        await transaction
          .select({ id: operationalActionHistoryRecords.id })
          .from(operationalActionHistoryRecords)
          .where(eq(operationalActionHistoryRecords.organizationId, ORG)),
      ).toHaveLength(4)
    })
  })

  it('surfaces a bypassed sequence as unavailable without inferring repair', async () => {
    await inRollback(async (transaction) => {
      const store = createOperationalActionHistoryStore(transaction)
      await store.append(entry('00000000-0000-4000-8000-000000001041', 'event-41'))
      await transaction.execute(sql`
        INSERT INTO operational_action_history_records (
          id, organization_id, sequence, property_id, actor_type, actor_id,
          action, outcome, resource_type, resource_id, reason_code,
          provenance_kind, provenance_id, source_event_type,
          source_event_version, source_context, source_aggregate_id,
          occurred_at, recorded_at
        )
        SELECT '00000000-0000-4000-8000-000000001042'::uuid,
               organization_id, 3, property_id, actor_type, actor_id,
               action, outcome, resource_type, resource_id, reason_code,
               provenance_kind, 'injected-gap', source_event_type,
               source_event_version, source_context, source_aggregate_id,
               occurred_at, recorded_at
        FROM operational_action_history_records
        WHERE id = '00000000-0000-4000-8000-000000001041'::uuid
      `)

      await expect(
        getOperationalActionHistoryReadiness({ store })({
          organizationId: ORG,
          observedAt: new Date('2026-08-28T12:00:00.000Z'),
        }),
      ).resolves.toMatchObject({
        state: 'unavailable',
        reason: 'unaccounted_sequence_gap',
        lastSequence: 1,
        coveredSequenceCount: 2,
        minimumSequence: 1,
        maximumSequence: 3,
      })
    })
  })
})
