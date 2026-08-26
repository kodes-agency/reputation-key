import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatches,
  notificationEmailQueue,
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
import { createNotificationEmailRepository } from './notification-email.repository'
import { digestBatchIdempotencyKey, digestMemberSet } from '../jobs/digest-assembly'

const ORG = organizationId('notification-digest-batch-test-org')
const USER = userId('notification-digest-batch-test-user')
const PROPERTY = '81000000-0000-4000-8000-000000000001'
const EMAIL_A = notificationEmailId('81000000-0000-4000-8000-000000000011')
const EMAIL_B = notificationEmailId('81000000-0000-4000-8000-000000000012')
const EMAIL_LATE = notificationEmailId('81000000-0000-4000-8000-000000000013')
const BATCH = notificationDigestBatchId('81000000-0000-4000-8000-000000000021')
const NOW = new Date('2026-08-25T08:00:00.000Z')

describe.sequential('notification digest batch repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db
      .delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Digest Test Property',
      slug: 'notification-digest-batch-test',
      timezone: 'UTC',
    })
    const notificationRows = [EMAIL_A, EMAIL_B, EMAIL_LATE].map((emailId, index) => ({
      id: `81000000-0000-4000-8000-00000000010${index + 1}`,
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'review.created',
      category: 'urgent_operational',
      priority: 'normal',
      status: 'unread',
      resourceType: 'inbox_item',
      resourceId: `digest-test-resource-${index}`,
      eventId: `digest-test-event-${index}`,
      title: 'New review',
      payload: {},
      createdAt: NOW,
      updatedAt: NOW,
      emailId,
    }))
    await db
      .insert(notifications)
      .values(notificationRows.map(({ emailId: _emailId, ...row }) => row))
    await db.insert(notificationEmailQueue).values(
      notificationRows.map((row, index) => ({
        id: row.emailId,
        notificationId: row.id,
        userId: USER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'daily',
        status: 'pending',
        priority: 'normal',
        idempotencyKey: `digest-test-queue-${index}`,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    )
  })

  afterAll(async () => {
    await db
      ?.delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.organizationId, ORG))
    await db?.delete(properties).where(eq(properties.organizationId, ORG))
    await lease?.release()
  })

  it('freezes exact members, serializes concurrent preparation, and settles atomically', async () => {
    const repo = createNotificationEmailRepository(db)
    const memberIds = [EMAIL_A, EMAIL_B] as const
    const memberDigest = digestMemberSet(memberIds)
    const input = {
      id: BATCH,
      organizationId: ORG,
      userId: USER,
      localDate: '2026-08-25',
      memberIds,
      memberDigest,
      contentDigest: 'a'.repeat(64),
      unsubscribeKeyVersion: 'v1',
      providerIdempotencyKey: digestBatchIdempotencyKey({
        organizationId: ORG,
        userId: USER,
        localDate: '2026-08-25',
        batchId: BATCH,
        memberDigest,
      }),
      preparedAt: NOW,
    }

    const [first, concurrent] = await Promise.all([
      repo.prepareDigestBatch(input),
      repo.prepareDigestBatch({
        ...input,
        id: notificationDigestBatchId('81000000-0000-4000-8000-000000000022'),
      }),
    ])
    const owner = first.created ? first : concurrent
    const follower = first.created ? concurrent : first
    expect(owner.created).toBe(true)
    expect(follower).toMatchObject({ created: false, batch: { id: owner.batch.id } })

    const frozen = await repo.findDigestBatchEntries(owner.batch.id, ORG, USER)
    expect(frozen.map((entry) => entry.id)).toEqual([EMAIL_A, EMAIL_B])

    await db
      .update(notificationEmailQueue)
      .set({ notBefore: new Date('2026-08-26T08:00:00.000Z') })
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await expect(
      repo.findDueRecipients('daily', new Date('2026-08-25T09:00:00.000Z')),
    ).resolves.toContainEqual({ organizationId: ORG, userId: USER })

    await expect(
      repo.settleDigestBatch({
        batchId: owner.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'accepted',
          providerMessageId: 'resend-message-1',
          acceptedAt: NOW,
        },
      }),
    ).resolves.toBe(true)

    const states = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, ORG),
          sql`${notificationEmailQueue.id} IN (${EMAIL_A}, ${EMAIL_B}, ${EMAIL_LATE})`,
        ),
      )
    expect(new Map(states.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'accepted'],
        [EMAIL_B, 'accepted'],
        [EMAIL_LATE, 'pending'],
      ]),
    )
    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toBeNull()
  })
})
