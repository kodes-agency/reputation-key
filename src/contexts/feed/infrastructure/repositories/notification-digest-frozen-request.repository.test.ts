// A digest batch keeps the provider request it was frozen with while it is
// open, so a retry the provider may already hold re-sends exactly that
// (real PostgreSQL). The request goes when the batch closes, and one that no
// longer matches the batch's content digest is never handed back.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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
import {
  digestBatchIdempotencyKey,
  digestMemberSet,
  digestProviderRequest,
} from '../digest-batch-identity'
import { createNotificationEmailRepository } from './notification-email.repository'

const ORG = organizationId('notification-digest-frozen-request-org')
const USER = userId('notification-digest-frozen-request-user')
const PROPERTY = '87000000-0000-4000-8000-000000000001'
const EMAIL = notificationEmailId('87000000-0000-4000-8000-000000000011')
const NOTIFICATION = '87000000-0000-4000-8000-000000000021'
const BATCH = notificationDigestBatchId('87000000-0000-4000-8000-000000000031')
const NOW = new Date('2026-09-25T08:00:00.000Z')

const REQUEST = {
  to: 'manager@example.com',
  subject: '1 update for Thursday 25 September',
  html: '<p>Reopened: review at Riverside</p>',
  text: 'Reopened: review at Riverside',
  headers: { 'List-Unsubscribe': '<https://app.example.com/unsubscribe>' },
}

const batchInput = (request = REQUEST) => {
  const memberIds = [EMAIL]
  const memberDigest = digestMemberSet(memberIds)
  return {
    id: BATCH,
    organizationId: ORG,
    userId: USER,
    localDate: '2026-09-25',
    memberIds,
    memberDigest,
    contentDigest: digestProviderRequest(REQUEST),
    providerIdempotencyKey: digestBatchIdempotencyKey({
      organizationId: ORG,
      userId: USER,
      localDate: '2026-09-25',
      batchId: BATCH,
      memberDigest,
    }),
    unsubscribeKeyVersion: 'v1',
    providerRequest: request,
    preparedAt: NOW,
  }
}

describe.sequential('a digest batch frozen request (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  const storedRequest = async () =>
    (
      await db
        .select({ request: notificationDigestBatches.providerRequest })
        .from(notificationDigestBatches)
        .where(eq(notificationDigestBatches.id, BATCH))
    )[0]?.request

  const settle = (
    repo: ReturnType<typeof createNotificationEmailRepository>,
    settlement: Parameters<
      ReturnType<typeof createNotificationEmailRepository>['settleDigestBatch']
    >[0]['settlement'],
  ) =>
    repo.settleDigestBatch({
      batchId: BATCH,
      organizationId: ORG,
      userId: USER,
      expectedContentDigest: digestProviderRequest(REQUEST),
      settlement,
    })

  const clear = async () => {
    await db
      .delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
  })

  beforeEach(async () => {
    await clear()
    await db.insert(properties).values({
      id: PROPERTY,
      organizationId: ORG,
      name: 'Riverside',
      slug: 'notification-digest-frozen-request',
      timezone: 'UTC',
    })
    await db.insert(notifications).values({
      id: NOTIFICATION,
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      type: 'inbox.reopened',
      category: 'workflow_collaboration',
      priority: 'normal',
      status: 'unread',
      resourceType: 'inbox_item',
      resourceId: 'frozen-request-resource',
      eventId: 'frozen-request-event',
      title: 'Reopened',
      payload: {},
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(notificationEmailQueue).values({
      id: EMAIL,
      notificationId: NOTIFICATION,
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY,
      category: 'workflow_collaboration',
      cadence: 'daily',
      status: 'pending',
      priority: 'normal',
      idempotencyKey: 'frozen-request-queue',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  afterAll(async () => {
    if (db) await clear()
    await lease?.release()
  })

  it('hands the frozen request back while a possibly accepted batch retries', async () => {
    const repo = createNotificationEmailRepository(db)
    await repo.prepareDigestBatch(batchInput())
    await settle(repo, {
      kind: 'rejected',
      classification: 'transient',
      nextAttemptAt: new Date(NOW.getTime() + 30_000),
      failedAt: NOW,
      refusedBeforeAcceptance: false,
    })

    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toMatchObject({
      state: 'retryable',
      everyAttemptRefused: false,
      providerRequest: REQUEST,
    })
  })

  it('drops the rendered mail once the batch is accepted', async () => {
    const repo = createNotificationEmailRepository(db)
    await repo.prepareDigestBatch(batchInput())

    await settle(repo, {
      kind: 'accepted',
      providerMessageId: 'provider-message-1',
      acceptedAt: NOW,
    })

    await expect(storedRequest()).resolves.toBeNull()
  })

  it('never hands back a stored request that no longer matches the batch', async () => {
    const repo = createNotificationEmailRepository(db)
    await repo.prepareDigestBatch(batchInput())
    await db
      .update(notificationDigestBatches)
      .set({ providerRequest: { ...REQUEST, html: '<p>Something else</p>' } })
      .where(eq(notificationDigestBatches.id, BATCH))

    await expect(repo.findOpenDigestBatch(ORG, USER)).resolves.toMatchObject({
      providerRequest: null,
    })
  })

  it('refuses to freeze a request that does not match the content digest', async () => {
    const repo = createNotificationEmailRepository(db)

    await expect(
      repo.prepareDigestBatch(batchInput({ ...REQUEST, subject: 'Changed' })),
    ).rejects.toThrow('Digest batch request does not match its content digest')
  })
})
