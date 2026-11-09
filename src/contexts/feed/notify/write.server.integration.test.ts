import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notifications, properties } from '#/shared/db/schema'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotification } from '../domain/notification-constructors'
import { applyCoalescence } from '../domain/notification-policy'
import { renderNotification } from '../domain/notification-templates'
import type { NotificationPayload } from '../domain/notification-payload'
import { createNotificationRepository } from '../infrastructure/repositories/notification.repository'
import { writeNotification } from './write.server'

const ORG = organizationId('notification-writer-org')
const PROPERTY = propertyId('86000000-0000-4000-8000-000000000001')
const USER = userId('notification-writer-user')
const NOW = new Date('2026-09-01T09:00:00.000Z')
const LATER = new Date('2026-09-01T09:05:00.000Z')

let nextResource = 100
let nextNotice = 1000
const freshResource = () =>
  `86000000-0000-4000-8000-${String(nextResource++).padStart(12, '0')}`

const escalation = (
  resourceId: string,
  eventId: string,
  payload: NotificationPayload,
  at: Date = NOW,
) => {
  const built = createNotification(
    {
      id: notificationId(
        `86000000-0000-4000-9000-${String(nextNotice++).padStart(12, '0')}`,
      ),
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'inbox.escalated',
      resourceType: 'inbox_item',
      resourceId,
      eventId,
      payload,
    },
    () => at,
  )
  if (built.isErr()) throw built.error
  return built.value
}

describe.sequential('notification writer (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const clearScope = async () => {
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }
  const rowsFor = (resourceId: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, ORG),
          eq(notifications.resourceId, resourceId),
        ),
      )

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await clearScope()
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Writer Property',
      slug: 'notification-writer',
      timezone: 'UTC',
    })
  })

  afterAll(async () => {
    if (db) await clearScope()
    await lease?.release()
  })

  it('inserts a notice that finds no waiting row as given', async () => {
    const resourceId = freshResource()
    const notice = escalation(resourceId, 'first-event', { waitingHours: 3 })

    const stored = await writeNotification(db, notice)

    expect(stored).toMatchObject({ id: notice.id, coalescedCount: 1, status: 'unread' })
    expect(await rowsFor(resourceId)).toHaveLength(1)
  })

  it('merges a repeat the way the policy coalesces, keeping what the first event captured', async () => {
    const resourceId = freshResource()
    const first = escalation(resourceId, 'e1', {
      propertyName: 'Writer Property',
      waitingHours: 3,
    })
    const repeat = escalation(resourceId, 'e2', { waitingHours: 9 }, LATER)
    await writeNotification(db, first)

    const stored = await writeNotification(db, repeat)

    const expected = applyCoalescence(first, repeat.payload, LATER)
    expect(stored).toMatchObject({
      id: first.id,
      coalescedCount: 2,
      payload: expected.payload,
    })
    expect(renderNotification(stored.type, stored.payload)).toEqual(
      renderNotification(expected.type, expected.payload),
    )
    expect(await rowsFor(resourceId)).toHaveLength(1)
  })

  it.each([
    ['in event order', ['a', 'b'] as const],
    ['against event order', ['b', 'a'] as const],
  ])(
    'absorbs both events of a pair that arrive %s into one row',
    async (_label, order) => {
      const resourceId = freshResource()
      const events = {
        a: escalation(resourceId, 'order-a', { waitingHours: 3 }),
        b: escalation(resourceId, 'order-b', { waitingHours: 9 }, LATER),
      }

      const [firstIn, secondIn] = order
      const landed = await writeNotification(db, events[firstIn])
      const absorbed = await writeNotification(db, events[secondIn])

      expect(landed.id).toBe(events[firstIn].id)
      expect(absorbed).toMatchObject({
        id: events[firstIn].id,
        coalescedCount: 2,
        payload: expect.objectContaining({ occurrences: 2 }),
      })
      // Newest arrival wins the merge, whichever event it carries.
      expect(absorbed.payload.waitingHours).toBe(events[secondIn].payload.waitingHours)
      expect(await rowsFor(resourceId)).toHaveLength(1)
    },
  )

  it('keeps every increment when many writers race for one empty slot', async () => {
    const resourceId = freshResource()
    const notices = Array.from({ length: 8 }, (_, n) =>
      escalation(resourceId, `race-${String(n)}`, { waitingHours: n + 1 }),
    )

    const stored = await Promise.all(
      notices.map((notice) => writeNotification(db, notice)),
    )

    const rows = await rowsFor(resourceId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      coalescedCount: 8,
      payload: expect.objectContaining({ occurrences: 8 }),
    })
    // Exactly one writer opened the row; the other seven were absorbed.
    expect(stored.filter((row, n) => row.id === notices[n]!.id)).toHaveLength(1)
  })

  it.each([
    [
      'read',
      (id: string) =>
        createNotificationRepository(db).markRead(id as never, USER, ORG, NOW, NOW),
    ],
    [
      'dismissed',
      (id: string) =>
        createNotificationRepository(db).updateStatus(
          id as never,
          USER,
          ORG,
          'dismissed',
          NOW,
        ),
    ],
    [
      'settled',
      async (id: string) => {
        await db
          .update(notifications)
          .set({ resolvedAt: NOW })
          .where(eq(notifications.id, id))
      },
    ],
  ] as const)(
    'opens a fresh waiting row when the earlier one is %s',
    async (_state, leave) => {
      const resourceId = freshResource()
      const first = escalation(resourceId, 'before', { waitingHours: 3 })
      await writeNotification(db, first)
      await leave(first.id)

      const second = escalation(resourceId, 'after', { waitingHours: 9 })
      const stored = await writeNotification(db, second)

      expect(stored).toMatchObject({ id: second.id, coalescedCount: 1 })
      const rows = await rowsFor(resourceId)
      expect(rows).toHaveLength(2)
      expect(rows.find((row) => row.id === first.id)).toMatchObject({ coalescedCount: 1 })
    },
  )

  it('never absorbs an email-only anchor, stored already read', async () => {
    const resourceId = freshResource()
    const waiting = escalation(resourceId, 'waiting', { waitingHours: 3 })
    await writeNotification(db, waiting)
    const anchor = { ...escalation(resourceId, 'anchor', {}), status: 'read' as const }

    const stored = await writeNotification(db, anchor)

    expect(stored).toMatchObject({ id: anchor.id, status: 'read', coalescedCount: 1 })
    expect(await rowsFor(resourceId)).toHaveLength(2)
  })

  it('leaves the partial unique index as the backstop against a second waiting row', async () => {
    const resourceId = freshResource()
    const first = escalation(resourceId, 'dup-1', {})
    await writeNotification(db, first)
    const second = escalation(resourceId, 'dup-2', {})

    await expect(
      db.insert(notifications).values({
        id: second.id,
        userId: second.userId,
        organizationId: second.organizationId,
        propertyId: second.propertyId,
        type: second.type,
        category: second.category,
        priority: second.priority,
        status: 'unread',
        resourceType: second.resourceType,
        resourceId,
        eventId: second.eventId,
        title: second.title,
        payload: second.payload,
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } })
    expect(
      await db.execute(
        sql`SELECT 1 FROM pg_indexes WHERE indexname = 'notifications_unread_resource_unique'`,
      ),
    ).toHaveProperty('rowCount', 1)
  })
})
