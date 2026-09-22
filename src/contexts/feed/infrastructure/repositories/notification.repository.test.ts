import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { notificationEmailQueue, notifications, properties } from '#/shared/db/schema'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { insertNotification } from '../../application/use-cases/insert-notification'
import { createNotification } from '../../domain/notification-constructors'
import { applyCoalescence } from '../../domain/notification-policy'
import { renderNotification } from '../../domain/notification-templates'
import type { NotificationPayload } from '../../domain/notification-payload'
import { createNotificationRepository } from './notification.repository'
import { createNotificationEmailRepository } from './notification-email.repository'
import { createNotificationPreferenceRepository } from './notification-preference.repository'

const ORG = organizationId('notification-repository-race-org')
const PROPERTY = propertyId('85000000-0000-4000-8000-000000000001')
const USER = userId('notification-repository-race-user')
const ITEM = '85000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-09-01T09:00:00.000Z')

const escalation = (
  id: string,
  eventId: string,
  payload: NotificationPayload,
  resourceId: string = ITEM,
) => {
  const built = createNotification(
    {
      id: notificationId(id),
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'inbox.escalated',
      resourceType: 'inbox_item',
      resourceId,
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
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
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

  // ── A read or dismiss that lands between the unread lookup and the bump ──
  //
  // The use case looks the unread row up, then bumps it: two statements with
  // nothing held in between. A read or dismiss committed in that gap used to
  // be overwritten by the bump — the new event was absorbed into a row the user
  // had already dealt with, and neither a fresh unread row nor its email was
  // ever written.

  it('refuses to bump a row that is no longer unread', async () => {
    const repo = createNotificationRepository(db)
    const readRow = escalation(
      '85000000-0000-4000-8000-000000000021',
      'refresh-guard-event-1',
      { propertyName: 'Raced Property', waitingHours: 3 },
      '85000000-0000-4000-8000-000000000003',
    )
    await repo.insert(readRow)
    await repo.markRead(readRow.id, USER, ORG, NOW, NOW)

    const refreshed = await repo.refreshUnread(
      applyCoalescence(readRow, { waitingHours: 9 }, NOW),
    )

    expect(refreshed).toBe(false)
    const [stored] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, readRow.id))
    expect(stored).toMatchObject({ status: 'read', coalescedCount: 1 })
  })

  it.each([
    ['read', '85000000-0000-4000-8000-000000000004', 31],
    ['dismissed', '85000000-0000-4000-8000-000000000005', 41],
  ] as const)(
    'opens a fresh unread row, and its email, when the row is %s between the lookup and the bump',
    async (status, resourceId, idBase) => {
      const repo = createNotificationRepository(db)
      const first = escalation(
        `85000000-0000-4000-8000-0000000000${idBase}`,
        `${status}-race-event-1`,
        { propertyName: 'Raced Property', waitingHours: 3 },
        resourceId,
      )
      await repo.insert(first)
      let nextId = idBase + 1
      const logger: LoggerPort = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: () => logger,
      }
      // The user's read (or dismiss) commits right after the lookup saw the
      // row unread, before the use case bumps it.
      const racedRepo = {
        ...repo,
        findUnreadByUserTypeResource: async (
          ...args: Parameters<typeof repo.findUnreadByUserTypeResource>
        ) => {
          const found = await repo.findUnreadByUserTypeResource(...args)
          if (found && status === 'read') {
            await repo.markRead(found.id, USER, ORG, NOW, NOW)
          } else if (found) {
            await repo.updateStatus(found.id, USER, ORG, 'dismissed', NOW)
          }
          return found
        },
      }

      const result = await insertNotification({
        notificationRepo: racedRepo,
        emailRepo: createNotificationEmailRepository(db),
        preferenceRepo: createNotificationPreferenceRepository(db),
        clock: () => NOW,
        idGen: () =>
          notificationId(`85000000-0000-4000-8000-0000000000${String(nextId++)}`),
        emailIdGen: () =>
          notificationEmailId(`85000000-0000-4000-9000-0000000000${String(nextId++)}`),
        logger,
      })({
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'inbox.escalated',
        resourceType: 'inbox_item',
        resourceId,
        eventId: `${status}-race-event-2`,
        payload: { propertyName: 'Raced Property', waitingHours: 9 },
      })

      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.organizationId, ORG),
            eq(notifications.resourceId, resourceId),
          ),
        )
        .orderBy(asc(notifications.eventId))
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        id: first.id,
        status,
        coalescedCount: 1,
        eventId: `${status}-race-event-1`,
      })
      expect(rows[1]).toMatchObject({
        status: 'unread',
        coalescedCount: 1,
        eventId: `${status}-race-event-2`,
      })
      expect(result).toMatchObject({ id: rows[1]!.id, status: 'unread' })
      // The re-fire's own urgent email is queued against the fresh row.
      const emails = await db
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.notificationId, rows[1]!.id))
      expect(emails).toHaveLength(1)
    },
  )
})
