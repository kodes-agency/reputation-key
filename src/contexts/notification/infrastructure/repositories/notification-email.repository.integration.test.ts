import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatchMembers,
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

const digestBatchInput = (
  id = BATCH,
): Parameters<
  ReturnType<typeof createNotificationEmailRepository>['prepareDigestBatch']
>[0] => {
  const memberIds = [EMAIL_A, EMAIL_B] as const
  const memberDigest = digestMemberSet(memberIds)
  return {
    id,
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
      batchId: id,
      memberDigest,
    }),
    preparedAt: NOW,
  }
}

describe.sequential('notification digest batch repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
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
    const input = digestBatchInput()

    const [first, concurrent] = await Promise.all([
      repo.prepareDigestBatch(input),
      repo.prepareDigestBatch(
        digestBatchInput(
          notificationDigestBatchId('81000000-0000-4000-8000-000000000022'),
        ),
      ),
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
        expectedContentDigest: 'b'.repeat(64),
        settlement: {
          kind: 'accepted',
          providerMessageId: 'must-not-accept-stale-content',
          acceptedAt: NOW,
        },
      }),
    ).resolves.toBe(false)

    const retryAt = new Date('2026-08-25T08:01:00.000Z')
    await expect(
      repo.settleDigestBatch({
        batchId: owner.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'rejected',
          classification: 'transient',
          nextAttemptAt: retryAt,
          failedAt: NOW,
        },
      }),
    ).resolves.toBe(true)
    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toMatchObject({
      id: owner.batch.id,
      state: 'retryable',
      retryCount: 1,
    })

    const retryStates = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(retryStates.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'failed'],
        [EMAIL_B, 'failed'],
        [EMAIL_LATE, 'pending'],
      ]),
    )

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

  it('rejects a member fingerprint or provider key that does not bind the exact batch', async () => {
    const repo = createNotificationEmailRepository(db)
    const input = digestBatchInput()

    await expect(
      repo.prepareDigestBatch({ ...input, memberDigest: 'b'.repeat(64) }),
    ).rejects.toThrow('Digest batch member fingerprint does not match exact members')
    await expect(
      repo.prepareDigestBatch({
        ...input,
        providerIdempotencyKey: `rk-digest-v2:${'c'.repeat(64)}`,
      }),
    ).rejects.toThrow('Digest batch provider key does not match immutable identity')
    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toBeNull()
  })

  it('refuses provider outcomes after membership corruption and allows terminal invalidation', async () => {
    const repo = createNotificationEmailRepository(db)
    const input = digestBatchInput()
    const prepared = await repo.prepareDigestBatch(input)

    await db
      .delete(notificationDigestBatchMembers)
      .where(
        and(
          eq(notificationDigestBatchMembers.batchId, prepared.batch.id),
          eq(notificationDigestBatchMembers.notificationEmailId, EMAIL_B),
        ),
      )

    await expect(
      repo.settleDigestBatch({
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'accepted',
          providerMessageId: 'must-not-settle-partial-membership',
          acceptedAt: NOW,
        },
      }),
    ).resolves.toBe(false)

    const beforeInvalidation = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(beforeInvalidation.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'pending'],
        [EMAIL_B, 'pending'],
        [EMAIL_LATE, 'pending'],
      ]),
    )

    await expect(
      repo.settleDigestBatch({
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: input.contentDigest,
        settlement: {
          kind: 'invalidated',
          reason: 'digest_membership_changed',
          invalidatedAt: NOW,
        },
      }),
    ).resolves.toBe(true)

    const afterInvalidation = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(afterInvalidation.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'suppressed'],
        [EMAIL_B, 'pending'],
        [EMAIL_LATE, 'pending'],
      ]),
    )
    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toBeNull()
  })

  it('terminates only the frozen members when provider-visible retry content drifts', async () => {
    const repo = createNotificationEmailRepository(db)
    const input = digestBatchInput()
    const prepared = await repo.prepareDigestBatch(input)

    await expect(
      repo.settleDigestBatch({
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: 'd'.repeat(64),
        settlement: { kind: 'content_mismatch', detectedAt: NOW },
      }),
    ).resolves.toBe(true)

    const states = await db
      .select({ id: notificationEmailQueue.id, status: notificationEmailQueue.status })
      .from(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    expect(new Map(states.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [EMAIL_A, 'suppressed'],
        [EMAIL_B, 'suppressed'],
        [EMAIL_LATE, 'pending'],
      ]),
    )
    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toBeNull()
    await expect(
      repo.settleDigestBatch({
        batchId: prepared.batch.id,
        organizationId: ORG,
        userId: USER,
        expectedContentDigest: 'd'.repeat(64),
        settlement: { kind: 'content_mismatch', detectedAt: NOW },
      }),
    ).resolves.toBe(false)
  })
})
