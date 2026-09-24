// The settlement write, against the real database.
//
// Settling has to reach every recipient's row about one resource without
// touching their read state, has to leave the bell's unread count, and has to
// cancel the mail queued behind those rows without disturbing mail the
// provider may already hold.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotification } from '../../domain/notification-constructors'
import { applyCoalescence } from '../../domain/notification-policy'
import { SETTLED_EMAIL_REASON } from '../../domain/notification-settlement'
import type { NotificationType } from '../../domain/notification-types'
import { createNotificationRepository } from './notification.repository'
import { createNotificationEmailRepository } from './notification-email.repository'

const ORG = organizationId('notification-settlement-org')
const PROPERTY = propertyId('86000000-0000-4000-8000-000000000001')
const ITEM = '86000000-0000-4000-8000-000000000002'
const OTHER_ITEM = '86000000-0000-4000-8000-000000000003'
const APPROVER = userId('notification-settlement-approver')
const SECOND_APPROVER = userId('notification-settlement-approver-2')
const NOW = new Date('2026-09-23T23:00:00.000Z')
const SETTLED_AT = new Date('2026-09-23T23:30:00.000Z')

const notice = (
  id: string,
  recipient: ReturnType<typeof userId>,
  type: NotificationType = 'reply.pending_approval',
  resourceId: string = ITEM,
) => {
  const built = createNotification(
    {
      id: notificationId(id),
      userId: recipient,
      organizationId: ORG,
      propertyId: PROPERTY,
      type,
      resourceType: 'inbox_item',
      resourceId,
      eventId: `settlement-${id}`,
      payload: { propertyName: 'Settled Hotel' },
    },
    () => NOW,
  )
  if (built.isErr()) throw built.error
  return built.value
}

describe.sequential('settling a notice whose work is done (real PostgreSQL)', () => {
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
      name: 'Settled Hotel',
      slug: 'notification-settlement',
      timezone: 'UTC',
    })
  })

  beforeEach(async () => {
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
  })

  afterAll(async () => {
    if (db) await clearScope()
    await lease?.release()
  })

  const feedHead = (recipient: ReturnType<typeof userId>) =>
    createNotificationRepository(db).readFeedHead({
      userId: recipient,
      organizationId: ORG,
      visiblePropertyIds: null,
      filter: 'unread',
      limit: 20,
    })

  it('settles every recipient waiting on the same work, in one write', async () => {
    const repo = createNotificationRepository(db)
    await repo.insert(notice('86000000-0000-4000-8000-000000000011', APPROVER))
    await repo.insert(notice('86000000-0000-4000-8000-000000000012', SECOND_APPROVER))

    const settled = await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    expect(settled).toHaveLength(2)
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, ORG))
    expect(rows.map((row) => row.resolvedAt?.toISOString())).toEqual([
      SETTLED_AT.toISOString(),
      SETTLED_AT.toISOString(),
    ])
  })

  it('leaves the row unread, because read is not resolved', async () => {
    const repo = createNotificationRepository(db)
    const waiting = notice('86000000-0000-4000-8000-000000000013', APPROVER)
    await repo.insert(waiting)

    await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    const stored = await repo.findById(waiting.id, ORG)
    expect(stored).toMatchObject({ status: 'unread', readAt: null })
  })

  it('takes the settled notice out of the bell count and the Unread tab', async () => {
    const repo = createNotificationRepository(db)
    await repo.insert(notice('86000000-0000-4000-8000-000000000014', APPROVER))
    await repo.insert(
      notice('86000000-0000-4000-8000-000000000015', APPROVER, 'inbox.escalated'),
    )

    await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    const head = await feedHead(APPROVER)
    expect(head.unreadCount).toBe(1)
    expect(head.page.notifications.map((row) => row.type)).toEqual(['inbox.escalated'])
  })

  it('keeps the settled notice readable in the feed, with its marker', async () => {
    const repo = createNotificationRepository(db)
    await repo.insert(notice('86000000-0000-4000-8000-000000000016', APPROVER))

    await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    const all = await createNotificationRepository(db).readFeedHead({
      userId: APPROVER,
      organizationId: ORG,
      visiblePropertyIds: null,
      filter: 'all',
      limit: 20,
    })
    expect(all.page.notifications).toHaveLength(1)
    expect(all.page.notifications[0]?.resolvedAt?.toISOString()).toBe(
      SETTLED_AT.toISOString(),
    )
  })

  it('leaves another resource, and another type, still waiting', async () => {
    const repo = createNotificationRepository(db)
    await repo.insert(
      notice(
        '86000000-0000-4000-8000-000000000017',
        APPROVER,
        'reply.pending_approval',
        OTHER_ITEM,
      ),
    )
    await repo.insert(
      notice('86000000-0000-4000-8000-000000000018', APPROVER, 'inbox.escalated'),
    )

    const settled = await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    expect(settled).toEqual([])
    expect((await feedHead(APPROVER)).unreadCount).toBe(2)
  })

  it('starts asking again when a repeat event lands on the settled row', async () => {
    const repo = createNotificationRepository(db)
    const waiting = notice('86000000-0000-4000-8000-00000000001a', APPROVER)
    await repo.insert(waiting)
    await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    // A second reply submitted on the same item: the row is waiting once more.
    const repeat = await repo.findUnreadByUserTypeResource(
      APPROVER,
      ORG,
      PROPERTY,
      'reply.pending_approval',
      ITEM,
    )
    await repo.refreshUnread(
      applyCoalescence(repeat!, { propertyName: 'Settled Hotel' }, SETTLED_AT),
    )

    expect((await repo.findById(waiting.id, ORG))?.resolvedAt).toBeNull()
    expect((await feedHead(APPROVER)).unreadCount).toBe(1)
  })

  it('starts asking again when a racing repeat lands through the upsert', async () => {
    const repo = createNotificationRepository(db)
    const first = notice('86000000-0000-4000-8000-00000000001b', APPROVER)
    await repo.insert(first)
    await repo.settleUnreadForResource({
      organizationId: ORG,
      types: ['reply.pending_approval'],
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    })

    const stored = await repo.insert(
      notice('86000000-0000-4000-8000-00000000001c', APPROVER),
    )

    expect(stored.id).toBe(first.id)
    expect(stored.resolvedAt).toBeNull()
    expect((await feedHead(APPROVER)).unreadCount).toBe(1)
  })

  it('settles nothing a second time, so a redelivered fact is a no-op', async () => {
    const repo = createNotificationRepository(db)
    await repo.insert(notice('86000000-0000-4000-8000-000000000019', APPROVER))
    const input = {
      organizationId: ORG,
      types: ['reply.pending_approval'] as const,
      resourceId: ITEM,
      resolvedAt: SETTLED_AT,
    }
    await repo.settleUnreadForResource(input)

    const again = await repo.settleUnreadForResource({
      ...input,
      resolvedAt: new Date('2026-09-24T01:00:00.000Z'),
    })

    expect(again).toEqual([])
    const stored = await repo.findById(
      notificationId('86000000-0000-4000-8000-000000000019'),
      ORG,
    )
    expect(stored?.resolvedAt?.toISOString()).toBe(SETTLED_AT.toISOString())
  })
})

describe.sequential('cancelling the mail behind settled work (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const QUEUED = '86000000-0000-4000-8000-000000000031'
  const ACCEPTED = '86000000-0000-4000-8000-000000000032'

  const queueRow = (id: string, notification: string, status: string) => ({
    id,
    notificationId: notification,
    userId: APPROVER as string,
    organizationId: ORG as string,
    propertyId: PROPERTY as string,
    category: 'urgent_operational',
    cadence: 'immediate',
    status,
    priority: 'urgent',
    idempotencyKey: `${id}:email`,
  })

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Settled Hotel',
      slug: 'notification-settlement-email',
      timezone: 'UTC',
    })
    const repo = createNotificationRepository(db)
    await repo.insert(notice(QUEUED, APPROVER))
    await repo.insert(
      notice(ACCEPTED, SECOND_APPROVER, 'reply.pending_approval', OTHER_ITEM),
    )
    await db
      .insert(notificationEmailQueue)
      .values([
        queueRow('86000000-0000-4000-8000-000000000041', QUEUED, 'pending'),
        queueRow('86000000-0000-4000-8000-000000000042', ACCEPTED, 'accepted'),
      ])
  })

  afterAll(async () => {
    if (db) {
      await db
        .delete(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, ORG))
      await db.delete(notifications).where(eq(notifications.organizationId, ORG))
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }
    await lease?.release()
  })

  it('cancels the pending email and leaves one the provider already holds', async () => {
    const emails = createNotificationEmailRepository(db)

    const cancelled = await emails.cancelQueuedForNotifications(
      [notificationId(QUEUED), notificationId(ACCEPTED)],
      ORG,
      SETTLED_EMAIL_REASON,
      SETTLED_AT,
    )

    expect(cancelled).toBe(1)
    const pending = await emails.findById(
      notificationEmailId('86000000-0000-4000-8000-000000000041'),
      ORG,
      PROPERTY,
    )
    const accepted = await emails.findById(
      notificationEmailId('86000000-0000-4000-8000-000000000042'),
      ORG,
      PROPERTY,
    )
    expect(pending).toMatchObject({
      status: 'cancelled',
      suppressionReason: SETTLED_EMAIL_REASON,
    })
    expect(accepted).toMatchObject({ status: 'accepted' })
  })
})
