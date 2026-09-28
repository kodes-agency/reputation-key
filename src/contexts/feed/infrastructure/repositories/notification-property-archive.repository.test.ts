// Archiving a Property, against real PostgreSQL (N70): Feed can tell an
// archived Property from an active one, and settles every notice still asking
// for work on it without touching another Property's.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notifications, properties } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createActivePropertyLookup } from './active-property'
import { createNotificationRepository } from './notification.repository'

const ORG = 'notification-property-archive-org'
const ARCHIVED = '89000000-0000-4000-8000-000000000001'
const ACTIVE = '89000000-0000-4000-8000-000000000002'
const ARCHIVED_AT = new Date('2026-09-24T02:00:00.000Z')

describe.sequential('an archived Property (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database
  const ids = { onArchived: randomUUID(), outcome: randomUUID(), onActive: randomUUID() }

  const row = (id: string, property: string, type: string) => ({
    id,
    userId: 'archive-manager',
    organizationId: ORG,
    propertyId: property,
    type,
    category: 'urgent_operational',
    resourceType: 'inbox_item',
    resourceId: randomUUID(),
    eventId: randomUUID(),
    title: 'Notice',
  })

  const clear = async () => {
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clear()
    await db.insert(properties).values([
      {
        id: ARCHIVED,
        organizationId: ORG,
        name: 'Archived Hotel',
        slug: 'notification-property-archive-archived',
        timezone: 'UTC',
        lifecycleState: 'archived',
      },
      {
        id: ACTIVE,
        organizationId: ORG,
        name: 'Active Hotel',
        slug: 'notification-property-archive-active',
        timezone: 'UTC',
      },
    ])
    await db
      .insert(notifications)
      .values([
        row(ids.onArchived, ARCHIVED, 'reply.pending_approval'),
        row(ids.outcome, ARCHIVED, 'reply.approved'),
        row(ids.onActive, ACTIVE, 'reply.pending_approval'),
      ])
  })

  afterAll(async () => {
    if (db) await clear()
    await lease?.release()
  })

  it('is told apart from an active one', async () => {
    const isActive = createActivePropertyLookup(db)

    await expect(isActive(organizationId(ORG), propertyId(ARCHIVED))).resolves.toBe(false)
    await expect(isActive(organizationId(ORG), propertyId(ACTIVE))).resolves.toBe(true)
  })

  it('settles its waiting work and nothing else', async () => {
    const settled = await createNotificationRepository(db).settleUnreadForProperty({
      organizationId: ORG,
      propertyId: ARCHIVED,
      types: ['reply.pending_approval', 'inbox.escalated'],
      resolvedAt: ARCHIVED_AT,
    })

    expect(settled).toEqual([ids.onArchived])
  })
})
