import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Queue } from 'bullmq'
import { and, eq, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  eventConsumerReceipts,
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
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { buildFakeInsertNotificationDeps } from '../application/use-cases/test-fixtures'
import {
  handleNotificationBulkAssignmentCompleted,
  ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER,
} from './bulk-assignment-outbox-consumers'
import { createInsertNotificationHandler } from './jobs/insert-notification.job'
import type { InsertNotificationJobData } from './jobs/insert-notification.job'
import { withBetaOutboxNotificationDelivery } from './outbox-notification-delivery'
import { createNotificationDeliverySettlement } from './repositories/notification-delivery-settlement.repository'

const ORG = organizationId('notification-redis-postgres-settlement-org')
const PROPERTY = propertyId('84000000-0000-4000-8000-000000000001')
const EVENT = '84000000-0000-4000-8000-000000000002'
const ITEM = '84000000-0000-4000-8000-000000000003'
const BULK = '84000000-0000-4000-8000-000000000004'
const RECIPIENT = userId('notification-redis-postgres-recipient')
const ACTOR = userId('notification-redis-postgres-actor')
const NOW = new Date('2026-08-27T08:00:00.000Z')

describe.sequential('notification Redis to PostgreSQL settlement', () => {
  let lease: TestLease
  let redisLease: RedisTestLease
  let db: Database
  let queue: Queue | undefined

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    clearEventSchemas()
    registerAllEventSchemas()
    redisLease = await acquireRedisTestLease()
    if (redisLease.available && redisLease.redis) {
      queue = new Queue(`notification-settlement-${randomUUID()}`, {
        connection: redisLease.redis as unknown as import('bullmq').ConnectionOptions,
      })
    }

    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Redis Settlement Property',
      slug: 'notification-redis-postgres-settlement',
      timezone: 'UTC',
    })
    await db.insert(outboxEvents).values({
      id: EVENT,
      eventType: 'inbox.inbox_items.bulk_assignment_completed',
      eventVersion: 1,
      payload: {},
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: 'inbox',
      sourceAggregateId: BULK,
      createdAt: NOW,
      publishedAt: NOW,
    })
  })

  afterAll(async () => {
    try {
      await queue?.obliterate({ force: true })
    } catch {
      // The suite owns a unique queue; absence after cleanup is acceptable.
    }
    await queue?.close()
    redisLease?.release()
    await db?.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db?.delete(properties).where(eq(properties.organizationId, ORG))
    clearEventSchemas()
    await lease?.release()
  })

  it('converges after enqueue succeeds, base receipt fails, and Redis prunes the job', async () => {
    if (!queue) return
    const outboxRepo = createOutboxRepository(db)
    const deliveryQueue = withBetaOutboxNotificationDelivery(queue, outboxRepo)
    const event: ConsumerEvent = {
      eventId: EVENT,
      eventType: 'inbox.inbox_items.bulk_assignment_completed',
      eventVersion: 1,
      payload: {
        organizationId: ORG,
        userId: ACTOR,
        bulkId: BULK,
        transitions: [
          {
            inboxItemId: ITEM,
            propertyId: PROPERTY,
            previousAssignee: null,
            nextAssignee: RECIPIENT,
          },
        ],
        count: 1,
        source: 'web',
        occurredAt: NOW.toISOString(),
      },
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: 'inbox',
      sourceAggregateId: BULK,
      recordedAt: NOW.toISOString(),
    }
    const firstBaseReceipt = vi.fn(async () => {
      throw new Error('postgres base receipt interrupted')
    })
    const userLookup = { findActorRole: vi.fn(async () => null) }

    await expect(
      handleNotificationBulkAssignmentCompleted(
        {
          queue: deliveryQueue,
          userLookup,
          receipts: { insertReceipt: firstBaseReceipt },
        },
        event,
      ),
    ).rejects.toThrow('postgres base receipt interrupted')

    const jobId = `${EVENT}-${RECIPIENT}-${PROPERTY}`
    const firstJob = await queue.getJob(jobId)
    expect(firstJob).toBeDefined()
    const logger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    }
    let id = 100
    const settlement = createNotificationDeliverySettlement({
      db,
      clock: () => NOW,
      idGen: () =>
        notificationId(`84000000-0000-4000-8000-${String(id++).padStart(12, '0')}`),
      emailIdGen: () =>
        notificationEmailId(`84000000-0000-4000-9000-${String(id++).padStart(12, '0')}`),
      logger,
    })
    const handler = createInsertNotificationHandler({
      ...buildFakeInsertNotificationDeps(),
      authorizeAudience: vi.fn(async () => true),
      deliverySettlement: settlement,
    })

    await handler(firstJob as import('bullmq').Job<InsertNotificationJobData>)
    await firstJob!.remove()

    // The outbox retries after its base receipt failure. Redis no longer has
    // the old job, so this really does enqueue a second physical job.
    await handleNotificationBulkAssignmentCompleted(
      { queue: deliveryQueue, userLookup, receipts: outboxRepo },
      event,
    )
    const replayedJob = await queue.getJob(jobId)
    expect(replayedJob).toBeDefined()
    await handler(replayedJob as import('bullmq').Job<InsertNotificationJobData>)
    await replayedJob!.remove()

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, ORG), eq(notifications.eventId, EVENT)))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.coalescedCount).toBe(1)

    const receipts = await db
      .select()
      .from(eventConsumerReceipts)
      .where(
        and(
          eq(eventConsumerReceipts.eventId, EVENT),
          like(eventConsumerReceipts.consumerName, 'notification.%'),
        ),
      )
    expect(receipts.map((row) => row.consumerName)).toHaveLength(3)
    expect(receipts.map((row) => row.consumerName)).toEqual(
      expect.arrayContaining([
        ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER,
        expect.stringMatching(/^notification\.enqueue:/),
        expect.stringMatching(/^notification\.materialized:/),
      ]),
    )
  }, 30_000)
})
