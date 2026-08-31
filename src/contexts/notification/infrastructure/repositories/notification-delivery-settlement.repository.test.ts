import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  eventConsumerReceipts,
  notificationEmailQueue,
  notifications,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { InsertNotificationJobData } from '../jobs/insert-notification.job'
import {
  parseOutboxNotificationDelivery,
  withOutboxNotificationDelivery,
} from '../outbox-notification-delivery'
import { createNotificationDeliverySettlement } from './notification-delivery-settlement.repository'

const ORG = organizationId('notification-delivery-settlement-org')
const PROPERTY = propertyId('82000000-0000-4000-8000-000000000001')
const EVENT = '82000000-0000-4000-8000-000000000002'
const FAILED_EVENT = '82000000-0000-4000-8000-000000000004'
const WRONG_SOURCE_EVENT = '82000000-0000-4000-8000-000000000007'
const ORGANIZATION_EVENT = '82000000-0000-4000-8000-000000000009'
const USER = userId('notification-delivery-settlement-user')
const NOW = new Date('2026-08-27T08:00:00.000Z')

describe.sequential('notification delivery settlement (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Settlement Property',
      slug: 'notification-delivery-settlement',
      timezone: 'UTC',
    })
    await db.insert(outboxEvents).values([
      {
        id: EVENT,
        eventType: 'inbox.inbox_item.created',
        eventVersion: 1,
        payload: {},
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'inbox',
        sourceAggregateId: '82000000-0000-4000-8000-000000000003',
        createdAt: NOW,
        publishedAt: NOW,
      },
      {
        id: FAILED_EVENT,
        eventType: 'review.reply.publish_failed',
        eventVersion: 1,
        payload: {},
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: '82000000-0000-4000-8000-000000000005',
        createdAt: NOW,
        publishedAt: NOW,
      },
      {
        id: WRONG_SOURCE_EVENT,
        eventType: 'review.reply.published',
        eventVersion: 1,
        payload: {},
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: '82000000-0000-4000-8000-000000000008',
        createdAt: NOW,
        publishedAt: NOW,
      },
      {
        id: ORGANIZATION_EVENT,
        eventType: 'identity.member.removed',
        eventVersion: 1,
        payload: { memberUserId: USER },
        organizationId: ORG,
        propertyId: null,
        sourceContext: 'identity',
        sourceAggregateId: USER,
        createdAt: NOW,
        publishedAt: NOW,
      },
    ])
  })

  afterAll(async () => {
    await db
      ?.delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db?.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db?.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db?.delete(properties).where(eq(properties.organizationId, ORG))
    await lease?.release()
  })

  it('settles Organization mandatory in-app and email rows without inventing a Property', async () => {
    const input: InsertNotificationJobData = {
      userId: USER,
      organizationId: ORG,
      propertyId: null,
      type: 'account.organization_access_removed',
      resourceType: 'organization',
      resourceId: ORG,
      eventId: ORGANIZATION_EVENT,
      payload: {},
      audience: {
        kind: 'affected_organization_user',
        eventId: ORGANIZATION_EVENT,
        eventType: 'identity.member.removed',
      },
    }
    let queued: unknown
    const queue = withOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt: vi.fn(async () => {}) },
      {
        eventType: 'identity.member.removed',
        consumerName: 'notification.on-identity-member-removed',
      },
    )
    await queue.add('insert-notification', input)
    const delivery = parseOutboxNotificationDelivery(queued)!
    const enqueueImmediateEmail = vi.fn(async () => {})
    let id = 100
    const logger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    }
    const settlement = createNotificationDeliverySettlement({
      db,
      clock: () => NOW,
      idGen: () =>
        notificationId(`82000000-0000-4000-8000-${String(id++).padStart(12, '0')}`),
      emailIdGen: () =>
        notificationEmailId(`82000000-0000-4000-9000-${String(id++).padStart(12, '0')}`),
      logger,
      enqueueImmediateEmail,
    })
    const { audience: _audience, ...notificationInput } = input

    await expect(settlement.settleAuthorized(notificationInput, delivery)).resolves.toBe(
      'applied',
    )

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, ORGANIZATION_EVENT))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      propertyId: null,
      category: 'mandatory',
      resourceType: 'organization',
      userId: USER,
    })
    const emails = await db
      .select()
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.notificationId, rows[0]!.id))
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({
      propertyId: null,
      category: 'mandatory',
      cadence: 'immediate',
      status: 'pending',
    })
    expect(enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: emails[0]!.id,
      organizationId: ORG,
    })
  })

  it('commits one notification and its materialization receipt across concurrent replay', async () => {
    const input: InsertNotificationJobData = {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'review.created',
      resourceType: 'inbox_item',
      resourceId: '82000000-0000-4000-8000-000000000003',
      eventId: EVENT,
      payload: { propertyName: 'Settlement Property', platform: 'google' },
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: PROPERTY },
      },
    }
    let queued: unknown
    const queue = withOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt: vi.fn(async () => {}) },
      {
        eventType: 'inbox.inbox_item.created',
        consumerName: 'notification.on-inbox-item-created',
      },
    )
    await queue.add('insert-notification', input)
    const delivery = parseOutboxNotificationDelivery(queued)!
    let id = 10
    const logger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    }
    const settlement = createNotificationDeliverySettlement({
      db,
      clock: () => NOW,
      idGen: () =>
        notificationId(`82000000-0000-4000-8000-${String(id++).padStart(12, '0')}`),
      emailIdGen: () =>
        notificationEmailId(`82000000-0000-4000-9000-${String(id++).padStart(12, '0')}`),
      logger,
    })
    const { audience: _audience, ...notificationInput } = input

    const outcomes = await Promise.all([
      settlement.settleAuthorized(notificationInput, delivery),
      settlement.settleAuthorized(notificationInput, delivery),
    ])

    expect(outcomes.sort()).toEqual(['applied', 'duplicate'])
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, ORG), eq(notifications.eventId, EVENT)))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ coalescedCount: 1, userId: USER })
    const receipts = await db
      .select()
      .from(eventConsumerReceipts)
      .where(
        and(
          eq(eventConsumerReceipts.eventId, EVENT),
          eq(eventConsumerReceipts.consumerName, delivery.materializedReceiptName),
        ),
      )
    expect(receipts).toHaveLength(1)
    expect(receipts[0]!.status).toBe('applied')
  })

  it('rolls back the claim and notification when a later email write fails', async () => {
    const input: InsertNotificationJobData = {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'reply.publish_failed',
      resourceType: 'reply',
      resourceId: '82000000-0000-4000-8000-000000000005',
      eventId: FAILED_EVENT,
      payload: { propertyName: 'Settlement Property', platform: 'google' },
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: PROPERTY },
      },
    }
    let queued: unknown
    const queue = withOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt: vi.fn(async () => {}) },
      {
        eventType: 'review.reply.publish_failed',
        consumerName: 'notification.on-review-reply-publish_failed',
      },
    )
    await queue.add('insert-notification', input)
    const delivery = parseOutboxNotificationDelivery(queued)!
    const logger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    }
    const settlement = createNotificationDeliverySettlement({
      db,
      clock: () => NOW,
      idGen: () => notificationId('82000000-0000-4000-8000-000000000014'),
      emailIdGen: () => {
        throw new Error('email construction interrupted')
      },
      logger,
    })
    const { audience: _audience, ...notificationInput } = input

    await expect(
      settlement.settleAuthorized(notificationInput, delivery),
    ).rejects.toThrow('email construction interrupted')

    const receipts = await db
      .select()
      .from(eventConsumerReceipts)
      .where(
        and(
          eq(eventConsumerReceipts.eventId, FAILED_EVENT),
          eq(eventConsumerReceipts.consumerName, delivery.materializedReceiptName),
        ),
      )
    expect(receipts).toHaveLength(0)
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, ORG),
          eq(notifications.eventId, FAILED_EVENT),
        ),
      )
    expect(rows).toHaveLength(0)
  })

  it('rejects a delivery marker whose durable source has a different route', async () => {
    const input: InsertNotificationJobData = {
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'review.created',
      resourceType: 'inbox_item',
      resourceId: '82000000-0000-4000-8000-000000000009',
      eventId: WRONG_SOURCE_EVENT,
      payload: { propertyName: 'Settlement Property', platform: 'google' },
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: PROPERTY },
      },
    }
    let queued: unknown
    const queue = withOutboxNotificationDelivery(
      {
        add: vi.fn(async (_name, data) => {
          queued = data
        }),
      },
      { insertReceipt: vi.fn(async () => {}) },
      {
        eventType: 'inbox.inbox_item.created',
        consumerName: 'notification.on-inbox-item-created',
      },
    )
    await queue.add('insert-notification', input)
    const delivery = parseOutboxNotificationDelivery(queued)!
    const logger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    }
    const settlement = createNotificationDeliverySettlement({
      db,
      clock: () => NOW,
      idGen: () => notificationId('82000000-0000-4000-8000-000000000012'),
      emailIdGen: () => notificationEmailId('82000000-0000-4000-9000-000000000013'),
      logger,
    })
    const { audience: _audience, ...notificationInput } = input

    await expect(
      settlement.settleAuthorized(notificationInput, delivery),
    ).rejects.toThrow('durable source attribution mismatch')

    expect(
      await db
        .select()
        .from(eventConsumerReceipts)
        .where(
          and(
            eq(eventConsumerReceipts.eventId, WRONG_SOURCE_EVENT),
            eq(eventConsumerReceipts.consumerName, delivery.materializedReceiptName),
          ),
        ),
    ).toHaveLength(0)
  })
})
