// A restricted read, or a retention assessment, that meets an append in flight.
//
// Both lock the tenant's sequence head to serialize with appends, redaction and
// hold lifecycle. They used to do it inside a REPEATABLE READ transaction whose
// first statement already took the snapshot, so a same-tenant append that
// committed while they waited for the lock ended them with SQLSTATE 40001, and
// the access code recorded it as "authority unavailable". The lock itself is
// the serialization, so they now take it first and read after it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  operationalActionHistoryRecordId,
  type OperationalActionRecord,
} from '../domain/operational-action-history'
import { createOperationalActionHistoryStore } from './operational-action-history-store'

const ORG = organizationId(`operational-history-race-${randomUUID()}`)
const PROPERTY = propertyId('property-race')
const OCCURRED_AT = new Date('2026-08-28T09:00:00.000Z')
const OBSERVED_AT = new Date('2026-08-29T00:00:00.000Z')
const BLOCKED_POLL_MS = 25
const BLOCKED_POLL_LIMIT = 200

let lease: TestLease
let db: Database

const record = (provenanceId: string): OperationalActionRecord => ({
  id: operationalActionHistoryRecordId(randomUUID()),
  organizationId: ORG,
  propertyId: PROPERTY,
  actorType: 'user',
  actorId: 'user-1',
  action: 'property.archived',
  outcome: 'succeeded',
  resourceType: 'property',
  resourceId: 'property-race',
  reasonCode: 'manager_requested',
  provenance: {
    kind: 'domain_fact',
    id: provenanceId,
    eventType: 'property.archived',
    eventVersion: 1,
    sourceContext: 'property',
    sourceAggregateId: 'property-race',
  },
  occurredAt: OCCURRED_AT,
  recordedAt: new Date(OCCURRED_AT.getTime() + 1_000),
})

const accessRecord = (): OperationalActionRecord => ({
  ...record(`access:${randomUUID()}`),
  propertyId: null,
  action: 'operational_history.accessed',
  resourceType: 'operational_history',
  resourceId: 'history',
  reasonCode: null,
  provenance: {
    kind: 'history_access',
    id: `access:${randomUUID()}`,
    eventType: null,
    eventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
  },
})

const assessmentRecord = (): OperationalActionRecord => ({
  ...record(`assessment:${randomUUID()}`),
  propertyId: null,
  actorType: 'operator',
  actorId: 'operator-1',
  action: 'operational_history.retention_assessed',
  resourceType: 'operational_history',
  resourceId: 'history',
  reasonCode: 'report_only_pending_counsel',
  provenance: {
    kind: 'history_lifecycle',
    id: `lifecycle:${randomUUID()}`,
    eventType: null,
    eventVersion: null,
    sourceContext: null,
    sourceAggregateId: null,
  },
})

/** Resolves once some backend is waiting on a lock, i.e. the read is queued behind the append. */
const waitForBlockedBackend = async (): Promise<void> => {
  for (let attempt = 0; attempt < BLOCKED_POLL_LIMIT; attempt += 1) {
    const result = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND wait_event_type = 'Lock'
    `)
    if ((result.rows[0]?.waiting ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, BLOCKED_POLL_MS))
  }
  throw new Error('the read never queued behind the in-flight append')
}

/**
 * An append for the tenant that has taken the head lock and not yet committed;
 * `commit` lets it finish.
 */
const appendInFlight = async (provenanceId: string) => {
  let commit!: () => void
  const gate = new Promise<void>((resolve) => {
    commit = resolve
  })
  let inFlight!: () => void
  const started = new Promise<void>((resolve) => {
    inFlight = resolve
  })
  const committed = db.transaction(async (transaction) => {
    await createOperationalActionHistoryStore(transaction).append(record(provenanceId))
    inFlight()
    await gate
  })
  await started
  return { commit, committed }
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
  db = drizzle(lease.pool) as Database
  // The tenant's head exists and is committed, as it is for any tenant in use.
  await createOperationalActionHistoryStore(db).append(record('seeded'))
})

afterAll(async () => {
  await lease.release()
})

describe('Operational Action History reads that meet an append in flight (real PostgreSQL)', () => {
  it('serves a restricted read after the append commits, and sees the appended record', async () => {
    const store = createOperationalActionHistoryStore(db)
    const append = await appendInFlight('read-race-in-flight')

    const read = store.readWithAccess({
      query: { organizationId: ORG, limit: 10, observedAt: OBSERVED_AT },
      accessRecord: accessRecord(),
    })
    await waitForBlockedBackend()
    append.commit()
    await append.committed

    const page = await read
    expect(page.items.map(({ provenance }) => provenance.id).sort()).toEqual([
      'read-race-in-flight',
      'seeded',
    ])
  })

  it('assesses retention after the append commits instead of failing the assessment', async () => {
    const store = createOperationalActionHistoryStore(db)
    const append = await appendInFlight('assess-race-in-flight')

    const assessment = store.assessRetention({
      organizationId: ORG,
      cutoff: OBSERVED_AT,
      assessmentRecord: assessmentRecord(),
    })
    await waitForBlockedBackend()
    append.commit()
    await append.committed

    await expect(assessment).resolves.toMatchObject({ heldCount: 0 })
  })
})
