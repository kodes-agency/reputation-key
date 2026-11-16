import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { auditLogs } from '#/shared/db/schema/audit'
import { auditEvents } from '#/shared/db/schema/audit-events.schema'
import { copyAuditLogs, countAuditLogsToCopy } from './copy-audit-logs.server'

let lease: TestLease
let db: Database
const org = `copy-${randomUUID()}`
const now = new Date('2026-11-16T12:00:00Z')
const day = 24 * 60 * 60 * 1000
const row = (overrides: Partial<typeof auditLogs.$inferInsert> = {}) => ({
  id: randomUUID(),
  organizationId: org,
  userId: 'user-1',
  action: 'goal.program.revised',
  resourceType: 'goal_program',
  resourceId: 'program-1',
  details: { propertyId: 'property-1', note: 'dropped' },
  createdAt: new Date(now.getTime() - 10 * day),
  ...overrides,
})
const eventsOf = () =>
  db.select().from(auditEvents).where(eq(auditEvents.organizationId, org))

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  try {
    if (db) {
      await db.delete(auditEvents).where(eq(auditEvents.organizationId, org))
      await db.delete(auditLogs).where(eq(auditLogs.organizationId, org))
    }
  } finally {
    await lease?.release()
  }
})

describe('copy of audit_logs into audit_events (PostgreSQL)', () => {
  it('counts, copies rows inside the window once, and leaves older rows alone', async () => {
    const inWindow = [row(), row({ action: 'platform.admin_invited', userId: 'op-1' })]
    const old = row({ createdAt: new Date(now.getTime() - 400 * day) })
    await db.insert(auditLogs).values([...inWindow, old])

    expect(await countAuditLogsToCopy(db, now)).toMatchObject({ unmappable: 0 })
    const before = (await countAuditLogsToCopy(db, now)).toCopy
    expect(before).toBeGreaterThanOrEqual(2)

    expect(await copyAuditLogs(db, { now, batchSize: 1 })).toEqual({ copied: before })
    const events = await eventsOf()
    expect(events.map((event) => event.sourceId).sort()).toEqual(
      inWindow.map((entry) => entry.id).sort(),
    )
    expect(events.find((event) => event.action === 'goal.program.revised')).toMatchObject(
      {
        propertyId: 'property-1',
        actorType: 'user',
        sourceKind: 'interactive_command',
      },
    )

    expect(await copyAuditLogs(db, { now })).toEqual({ copied: 0 })
    expect(await countAuditLogsToCopy(db, now)).toEqual({ toCopy: 0, unmappable: 0 })
    expect(await eventsOf()).toHaveLength(2)
  })

  it('refuses before writing anything when a row cannot be mapped', async () => {
    const good = row()
    await db.insert(auditLogs).values([good, row({ resourceId: 'has a space' })])
    expect((await countAuditLogsToCopy(db, now)).unmappable).toBe(1)

    await expect(copyAuditLogs(db, { now })).rejects.toThrow(/cannot be copied/)
    expect((await eventsOf()).some((event) => event.sourceId === good.id)).toBe(false)
  })
})
