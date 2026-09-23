// The digest run's immediate orphan sweep against real PostgreSQL: a mandatory
// Organization notice whose post-commit enqueue failed, or whose job spent its
// attempts, must be found and re-enqueued by the next sweep.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  eventConsumerReceipts,
  notificationEmailQueue,
  notifications,
  outboxEvents,
} from '#/shared/db/schema'
import {
  notificationEmailId,
  notificationId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { InsertNotificationJobData } from './insert-notification.job'
import {
  parseOutboxNotificationDelivery,
  withOutboxNotificationDelivery,
} from '../outbox-notification-delivery'
import { createNotificationDeliverySettlement } from '../repositories/notification-delivery-settlement.repository'
import { createNotificationEmailRepository } from '../repositories/notification-email.repository'
import { createDigestNotificationJobHandler } from './digest-notification.job'
import { createFakeJobLogger } from './test-fixtures'

const ORG = organizationId('digest-orphan-sweep-org')
const USER = userId('digest-orphan-sweep-user')
const EVENT = '83000000-0000-4000-8000-000000000001'
const NOTIFICATION = notificationId('83000000-0000-4000-8000-000000000002')
const EMAIL = notificationEmailId('83000000-0000-4000-9000-000000000003')
const NOW = new Date('2026-08-27T08:00:00.000Z')
const LATER = new Date('2026-08-27T09:00:00.000Z')

describe.sequential(
  'digest orphan sweep — Organization-scoped mail (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const cleanUp = async () => {
      await db
        .delete(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, ORG))
      await db.delete(notifications).where(eq(notifications.organizationId, ORG))
      await db
        .delete(eventConsumerReceipts)
        .where(eq(eventConsumerReceipts.eventId, EVENT))
      await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
    })

    beforeEach(async () => {
      await cleanUp()
      await db.insert(outboxEvents).values({
        id: EVENT,
        eventType: 'identity.member.removed',
        eventVersion: 1,
        payload: { memberUserId: USER },
        organizationId: ORG,
        propertyId: null,
        sourceContext: 'identity',
        sourceAggregateId: USER,
        createdAt: NOW,
        publishedAt: NOW,
      })
    })

    afterAll(async () => {
      if (db) await cleanUp()
      await lease?.release()
    })

    /** Settle the access-removed notice while Redis refuses the urgent job. */
    const settleWhileRedisIsDown = async () => {
      const input: InsertNotificationJobData = {
        userId: USER,
        organizationId: ORG,
        propertyId: null,
        type: 'account.organization_access_removed',
        resourceType: 'organization',
        resourceId: ORG,
        eventId: EVENT,
        payload: {},
        audience: {
          kind: 'affected_organization_user',
          eventId: EVENT,
          eventType: 'identity.member.removed',
        },
      }
      let queued: unknown
      const queue = withOutboxNotificationDelivery(
        { add: vi.fn(async (_name, data) => void (queued = data)) },
        { insertReceipt: vi.fn(async () => {}) },
        {
          eventType: 'identity.member.removed',
          consumerName: 'notification.on-identity-member-removed',
        },
      )
      await queue.add('insert-notification', input)
      const logger = createFakeJobLogger()
      const settlement = createNotificationDeliverySettlement({
        db,
        clock: () => NOW,
        idGen: () => NOTIFICATION,
        emailIdGen: () => EMAIL,
        logger,
        enqueueImmediateEmail: vi.fn(async () => {
          throw new Error('READONLY You can not write against a read only replica.')
        }),
      })
      const { audience, ...notificationInput } = input
      await settlement.settleAuthorized(
        notificationInput,
        parseOutboxNotificationDelivery(queued)!,
        audience,
      )
      return logger
    }

    const runDigestSweep = async (now: Date) => {
      const enqueueImmediate = vi.fn(async () => {})
      const authorizeScope = vi.fn(async (org: string) => org === ORG)
      const emailRepo = createNotificationEmailRepository(db)
      await createDigestNotificationJobHandler({
        pool: lease.pool,
        // The daily leg belongs to other suites; only the sweep is under test.
        emailRepo: { ...emailRepo, findDueRecipients: async () => [] },
        authorizeScope,
        enqueueImmediate,
        logger: createFakeJobLogger(),
        clock: () => now,
      } as unknown as Parameters<typeof createDigestNotificationJobHandler>[0])(
        {} as Job<void>,
      )
      return { enqueueImmediate, authorizeScope }
    }

    it('names the stranded row when the enqueue fails, and the next sweep re-enqueues it', async () => {
      const logger = await settleWhileRedisIsDown()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: `notification-email:${EMAIL}` }),
        'Immediate notification email enqueue failed after delivery settlement',
      )
      const { enqueueImmediate, authorizeScope } = await runDigestSweep(LATER)

      expect(authorizeScope).toHaveBeenCalledWith(ORG)
      expect(enqueueImmediate).toHaveBeenCalledWith({
        notificationEmailId: EMAIL,
        organizationId: ORG,
      })
    })

    it('re-enqueues a mandatory row whose job spent its attempts on transient failures', async () => {
      await settleWhileRedisIsDown()
      await db
        .update(notificationEmailQueue)
        .set({
          status: 'failed',
          lastErrorClass: 'transient',
          retryCount: 3,
          nextAttemptAt: new Date(LATER.getTime() - 60_000),
        })
        .where(eq(notificationEmailQueue.id, EMAIL))

      const { enqueueImmediate } = await runDigestSweep(LATER)

      expect(enqueueImmediate).toHaveBeenCalledWith({
        notificationEmailId: EMAIL,
        organizationId: ORG,
      })
    })

    it('leaves a row alone until its retry is due, and once its retry budget is spent', async () => {
      await settleWhileRedisIsDown()
      await db
        .update(notificationEmailQueue)
        .set({
          status: 'failed',
          lastErrorClass: 'transient',
          retryCount: 3,
          nextAttemptAt: new Date(LATER.getTime() + 60_000),
        })
        .where(eq(notificationEmailQueue.id, EMAIL))
      const notYetDue = await runDigestSweep(LATER)
      await db
        .update(notificationEmailQueue)
        .set({ retryCount: 5, nextAttemptAt: null })
        .where(eq(notificationEmailQueue.id, EMAIL))
      const exhausted = await runDigestSweep(LATER)

      expect(notYetDue.enqueueImmediate).not.toHaveBeenCalled()
      expect(exhausted.enqueueImmediate).not.toHaveBeenCalled()
    })
  },
)
