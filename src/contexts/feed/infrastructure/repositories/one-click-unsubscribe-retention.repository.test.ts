// A one-click unsubscribe link must keep working after the 90-day retention
// sweep deletes the queue rows and digest batch its token points at: the mail
// sits in an inbox far longer than the queue keeps its delivery records.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatches,
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  properties,
} from '#/shared/db/schema'
import {
  notificationDigestBatchId,
  notificationEmailId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { digestBatchIdempotencyKey, digestMemberSet } from '../digest-batch-identity'
import { createNotificationEmailRepository } from './notification-email.repository'
import { createOneClickUnsubscribeRepository } from './one-click-unsubscribe.repository'

const ORG = organizationId('one-click-unsubscribe-retention-org')
const USER = userId('one-click-unsubscribe-retention-user')
const PROPERTY_A = '86000000-0000-4000-8000-000000000001'
const PROPERTY_B = '86000000-0000-4000-8000-000000000002'
const URGENT = notificationEmailId('86000000-0000-4000-8000-000000000011')
const DAILY_A = notificationEmailId('86000000-0000-4000-8000-000000000012')
const DAILY_B = notificationEmailId('86000000-0000-4000-8000-000000000013')
const BATCH = notificationDigestBatchId('86000000-0000-4000-8000-000000000021')
const NOW = new Date('2026-08-26T08:00:00.000Z')
const DAYS_LATER = new Date('2026-12-01T08:00:00.000Z')

const SEEDS = [
  {
    id: URGENT,
    propertyId: PROPERTY_A,
    category: 'urgent_operational',
    cadence: 'immediate',
  },
  {
    id: DAILY_A,
    propertyId: PROPERTY_A,
    category: 'workflow_collaboration',
    cadence: 'daily',
  },
  { id: DAILY_B, propertyId: PROPERTY_B, category: 'recognition', cadence: 'daily' },
] as const

describe.sequential(
  'one-click unsubscribe after queue retention (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const cleanUp = async () => {
      await db
        .delete(notificationDigestBatches)
        .where(eq(notificationDigestBatches.organizationId, ORG))
      await db
        .delete(notificationPreferences)
        .where(eq(notificationPreferences.organizationId, ORG))
      await db.delete(notifications).where(eq(notifications.organizationId, ORG))
      // Cascades the queue rows and any unsubscribe scope kept for them.
      await db.delete(properties).where(eq(properties.organizationId, ORG))
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
    })

    beforeEach(async () => {
      await cleanUp()
      await db.insert(properties).values(
        [PROPERTY_A, PROPERTY_B].map((id, index) => ({
          id,
          organizationId: ORG,
          name: `Retention ${index}`,
          slug: `one-click-unsubscribe-retention-${index}`,
          timezone: 'UTC',
        })),
      )
      await db.insert(notifications).values(
        SEEDS.map((seed, index) => ({
          id: `86000000-0000-4000-8000-00000000010${index}`,
          userId: USER,
          organizationId: ORG,
          propertyId: seed.propertyId,
          type: 'review.created',
          category: seed.category,
          resourceType: 'inbox_item',
          resourceId: `one-click-retention-${index}`,
          eventId: `one-click-retention-event-${index}`,
          title: 'Notification',
          payload: {},
        })),
      )
      await db.insert(notificationEmailQueue).values(
        SEEDS.map((seed, index) => ({
          id: seed.id,
          notificationId: `86000000-0000-4000-8000-00000000010${index}`,
          userId: USER,
          organizationId: ORG,
          propertyId: seed.propertyId,
          category: seed.category,
          cadence: seed.cadence,
          idempotencyKey: `one-click-retention-${index}`,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      )
    })

    afterAll(async () => {
      if (db) await cleanUp()
      await lease?.release()
    })

    /** What the 90-day sweep leaves behind: no queue row, no batch. */
    const runRetention = async () => {
      await db
        .delete(notificationDigestBatches)
        .where(eq(notificationDigestBatches.organizationId, ORG))
      await db
        .delete(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, ORG))
    }

    const disabledEmailScopes = async () =>
      (
        await db
          .select()
          .from(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.organizationId, ORG),
              eq(notificationPreferences.channel, 'email'),
              eq(notificationPreferences.enabled, false),
            ),
          )
      )
        .map((row) => `${row.propertyId}:${row.category}`)
        .sort()

    it('still unsubscribes from an urgent email whose queue row retention deleted', async () => {
      const emailRepo = createNotificationEmailRepository(db)
      await emailRepo.recordEmailUnsubscribeScope(URGENT, ORG, NOW)
      await emailRepo.markAccepted(URGENT, ORG, PROPERTY_A, 'resend-retention-1', NOW)
      await runRetention()

      await expect(
        createOneClickUnsubscribeRepository(db).apply(
          { kind: 'email', id: URGENT },
          DAYS_LATER,
        ),
      ).resolves.toBe(1)
      expect(await disabledEmailScopes()).toEqual([`${PROPERTY_A}:urgent_operational`])
    })

    it('still unsubscribes from a digest whose batch and rows retention deleted', async () => {
      const emailRepo = createNotificationEmailRepository(db)
      const memberIds = [DAILY_A, DAILY_B]
      const memberDigest = digestMemberSet(memberIds)
      await emailRepo.prepareDigestBatch({
        id: BATCH,
        organizationId: ORG,
        userId: USER,
        localDate: '2026-08-26',
        memberIds,
        memberDigest,
        contentDigest: 'c'.repeat(64),
        providerIdempotencyKey: digestBatchIdempotencyKey({
          organizationId: ORG,
          userId: USER,
          localDate: '2026-08-26',
          batchId: BATCH,
          memberDigest,
        }),
        unsubscribeKeyVersion: 'v1',
        preparedAt: NOW,
      })
      await runRetention()

      await expect(
        createOneClickUnsubscribeRepository(db).apply(
          { kind: 'digest', id: BATCH },
          DAYS_LATER,
        ),
      ).resolves.toBe(2)
      expect(await disabledEmailScopes()).toEqual(
        [`${PROPERTY_A}:workflow_collaboration`, `${PROPERTY_B}:recognition`].sort(),
      )
    })
  },
)
