import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { auditEvents } from '#/shared/db/schema/audit-events.schema'
import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { writeAuditEvent } from './write.server'
import { readAuditEvents } from '../application/public-api'
import { AUDIT_EVENT_RETENTION_RULE, auditEventCutoff } from './retention.server'

let lease: TestLease
let db: Database
const org = `audit-${randomUUID()}`
const otherOrg = `audit-${randomUUID()}`
const now = new Date('2026-11-07T12:00:00Z')
const event = (sourceId = randomUUID(), organizationId = org) => ({
  organizationId,
  propertyId: null,
  actorType: 'user' as const,
  actorId: 'user-1',
  action: 'property.archived',
  outcome: 'succeeded' as const,
  resourceType: 'property',
  resourceId: 'property-1',
  sourceKind: 'domain_fact' as const,
  sourceId,
  sourceEventType: 'property.archived',
  sourceEventVersion: 1,
  sourceContext: 'property',
  sourceAggregateId: 'property-1',
  occurredAt: new Date('2026-11-07T11:00:00Z'),
})

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  try {
    if (db) {
      await db.delete(auditEvents).where(eq(auditEvents.organizationId, org))
      await db.delete(auditEvents).where(eq(auditEvents.organizationId, otherOrg))
    }
  } finally {
    await lease?.release()
  }
})

describe('audit events (PostgreSQL)', () => {
  it('replays one source as one row and refuses reuse for a different action', async () => {
    const input = event()
    const results = await Promise.all([
      writeAuditEvent(db, input),
      writeAuditEvent(db, input),
    ])
    const first = results.find((result) => result.status === 'appended')!
    const replay = results.find((result) => result.status === 'duplicate')
    expect(first).toBeDefined()
    expect(replay).toEqual({ status: 'duplicate', id: first.id })
    await expect(
      writeAuditEvent(db, { ...input, resourceId: 'property-2' }),
    ).rejects.toThrow('Audit source identity conflict')
    expect(
      await db.select().from(auditEvents).where(eq(auditEvents.sourceId, input.sourceId)),
    ).toHaveLength(1)
  })

  it('scopes reads and deduplication to the authorized Organization', async () => {
    const sourceId = randomUUID()
    await writeAuditEvent(db, event(sourceId, org))
    await writeAuditEvent(db, event(sourceId, otherOrg))
    const rows = await readAuditEvents(db, { organizationId: org, observedAt: now })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.organizationId === org)).toBe(true)
    expect(rows.filter((row) => row.sourceId === sourceId)).toHaveLength(1)
    await expect(
      readAuditEvents(db, { organizationId: org, observedAt: now, limit: 101 }),
    ).rejects.toThrow(ZodError)
  })

  it('refuses content at both the owning boundary and direct SQL writes', async () => {
    await expect(
      writeAuditEvent(db, { ...event(), details: 'private content' }),
    ).rejects.toThrow(ZodError)
    await expect(
      db.insert(auditEvents).values({ ...event(), actorId: 'private content' }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'audit_events_actor_id_valid' },
    })
    await expect(
      db.insert(auditEvents).values({ ...event(), sourceContext: null }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'audit_events_source_valid' },
    })
    const [shape] = await db
      .execute(
        sql`SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_events'
      AND data_type IN ('json', 'jsonb', 'bytea')`,
      )
      .then((result) => result.rows)
    expect(shape?.count).toBe(0)
  })

  it('expires by occurrence, keeps the exact boundary, and excludes future rows from reads', async () => {
    const tenant = event()
    const cutoff = auditEventCutoff(now)
    const old = await writeAuditEvent(db, {
      ...tenant,
      sourceId: randomUUID(),
      occurredAt: new Date(cutoff.getTime() - 1),
    })
    const edge = await writeAuditEvent(db, {
      ...tenant,
      sourceId: randomUUID(),
      occurredAt: cutoff,
    })
    const future = await writeAuditEvent(db, {
      ...tenant,
      sourceId: randomUUID(),
      occurredAt: new Date(now.getTime() + 1),
    })
    const visible = await readAuditEvents(db, { organizationId: org, observedAt: now })
    expect(visible.map((row) => row.id)).toContain(edge.id)
    expect(visible.map((row) => row.id)).not.toContain(old.id)
    expect(visible.map((row) => row.id)).not.toContain(future.id)
    const rule = {
      ...AUDIT_EVENT_RETENTION_RULE,
      equalsWhere: undefined,
      extraWhere: `organization_id = '${org}'`,
    }
    await executeRetentionRule(db, rule, { cutoff, batchSize: 100 })
    expect(await db.select().from(auditEvents).where(eq(auditEvents.id, old.id))).toEqual(
      [],
    )
    expect(
      await db.select().from(auditEvents).where(eq(auditEvents.id, edge.id)),
    ).toHaveLength(1)
  })
})
