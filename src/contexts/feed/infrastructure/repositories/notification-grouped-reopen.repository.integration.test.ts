// The grouped reopens still waiting on a Property, each with the fact that
// raised it, against real PostgreSQL (N15). The row names only its first
// item; the source fact names them all.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notifications, properties } from '#/shared/db/schema'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { notificationId, organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createGroupedReopenStore } from './notification-grouped-reopen.repository'

const ORG = 'notification-grouped-reopen-org'
const PROPERTY = '88000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY = '88000000-0000-4000-8000-000000000002'
const SOURCE = randomUUID()
const RESOLVED_AT = new Date('2026-09-24T02:00:00.000Z')
const reopened = {
  organizationId: ORG,
  userId: 'actor',
  reopened: [{ inboxItemId: 'a' }],
}

describe.sequential('grouped reopens still waiting (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database
  const ids = {
    waiting: randomUUID(),
    settled: randomUUID(),
    elsewhere: randomUUID(),
    unsourced: randomUUID(),
  }

  const row = (
    id: string,
    overrides: Partial<typeof notifications.$inferInsert> = {},
  ) => ({
    id,
    userId: 'grouped-manager',
    organizationId: ORG,
    propertyId: PROPERTY,
    type: 'inbox.bulk_reopened',
    category: 'urgent_operational',
    resourceType: 'inbox_item',
    resourceId: randomUUID(),
    eventId: SOURCE,
    title: 'Items reopened',
    ...overrides,
  })

  const clear = async () => {
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clear()
    await db.insert(properties).values(
      [PROPERTY, OTHER_PROPERTY].map((id, index) => ({
        id,
        organizationId: ORG,
        name: `Grouped Hotel ${index}`,
        slug: `notification-grouped-reopen-${index}`,
        timezone: 'UTC',
      })),
    )
    await db.insert(outboxEvents).values({
      id: SOURCE,
      eventType: 'inbox.inbox_items.bulk_reopen_completed',
      payload: reopened,
      organizationId: ORG,
      sourceContext: 'inbox',
      sourceAggregateId: 'bulk-grouped-reopen',
    })
    await db
      .insert(notifications)
      .values([
        row(ids.waiting),
        row(ids.settled, { resolvedAt: RESOLVED_AT }),
        row(ids.elsewhere, { propertyId: OTHER_PROPERTY }),
        row(ids.unsourced, { eventId: 'not-an-outbox-id', resourceId: randomUUID() }),
      ])
  })

  afterAll(async () => {
    if (db) await clear()
    await lease?.release()
  })

  it('finds the waiting rows on the Property with the fact that raised them', async () => {
    const waiting = await createGroupedReopenStore(db).findWaiting({
      organizationId: organizationId(ORG),
      propertyId: propertyId(PROPERTY),
    })

    expect(waiting).toEqual([{ id: ids.waiting, coalescedCount: 1, source: reopened }])
  })

  it('settles exactly the rows it is given, once', async () => {
    const store = createGroupedReopenStore(db)
    const input = {
      organizationId: organizationId(ORG),
      ids: [ids.waiting, ids.settled].map(notificationId),
      resolvedAt: RESOLVED_AT,
    }

    await expect(store.settle(input)).resolves.toEqual([ids.waiting])
    await expect(store.settle(input)).resolves.toEqual([])
  })
})
