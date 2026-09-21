import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notifications, properties } from '#/shared/db/schema'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotification } from '../../domain/notification-constructors'
import { applyCoalescence } from '../../domain/notification-policy'
import { renderNotification } from '../../domain/notification-templates'
import type { NotificationPayload } from '../../domain/notification-payload'
import { createNotificationRepository } from './notification.repository'

const ORG = organizationId('notification-repository-race-org')
const PROPERTY = propertyId('85000000-0000-4000-8000-000000000001')
const USER = userId('notification-repository-race-user')
const ITEM = '85000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-09-01T09:00:00.000Z')

const escalation = (id: string, eventId: string, payload: NotificationPayload) => {
  const built = createNotification(
    {
      id: notificationId(id),
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'inbox.escalated',
      resourceType: 'inbox_item',
      resourceId: ITEM,
      eventId,
      payload,
    },
    () => NOW,
  )
  if (built.isErr()) throw built.error
  return built.value
}

describe.sequential('notification repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clearScope = async () => {
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearScope()
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Raced Property',
      slug: 'notification-repository-race',
      timezone: 'UTC',
    })
  })

  afterAll(async () => {
    if (db) await clearScope()
    await lease?.release()
  })

  it('merges a repeat that raced past the unread lookup the way the use case coalesces', async () => {
    const repo = createNotificationRepository(db)
    const first = escalation('85000000-0000-4000-8000-000000000011', 'race-event-1', {
      propertyName: 'Raced Property',
      waitingHours: 3,
    })
    // The second event could not resolve the name and has waited longer.
    const repeat = escalation('85000000-0000-4000-8000-000000000012', 'race-event-2', {
      waitingHours: 9,
    })
    await repo.insert(first)

    const stored = await repo.insert(repeat)

    // The same row the checked path would have produced: newest-wins merge,
    // the name the first event captured kept, the count written into the
    // payload so the copy can say how often it happened.
    const expected = applyCoalescence(first, repeat.payload, NOW)
    expect(stored).toMatchObject({
      id: first.id,
      coalescedCount: 2,
      payload: expected.payload,
    })
    expect(renderNotification(stored.type, stored.payload)).toEqual(
      renderNotification(expected.type, expected.payload),
    )
  })
})
