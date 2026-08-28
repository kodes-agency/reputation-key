import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatchMembers,
  notificationDigestBatches,
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  properties,
} from '#/shared/db/schema'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createOneClickUnsubscribeRepository } from './one-click-unsubscribe.repository'

const ORG = 'one-click-unsubscribe-test-org'
const USER = 'one-click-unsubscribe-test-user'
const PROPERTY_A = '85000000-0000-4000-8000-000000000001'
const PROPERTY_B = '85000000-0000-4000-8000-000000000002'
const EMAIL_A = '85000000-0000-4000-8000-000000000011'
const EMAIL_B = '85000000-0000-4000-8000-000000000012'
const EMAIL_MANDATORY = '85000000-0000-4000-8000-000000000013'
const BATCH = '85000000-0000-4000-8000-000000000021'
const NOW = new Date('2026-08-26T10:00:00.000Z')

describe.sequential('one-click unsubscribe repository (real PostgreSQL)', () => {
  let lease: TestLease
  let db: Database

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db
      .delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.id, BATCH))
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
    await db.insert(properties).values([
      {
        id: PROPERTY_A,
        organizationId: ORG,
        name: 'One-click A',
        slug: 'one-click-unsubscribe-a',
        timezone: 'UTC',
      },
      {
        id: PROPERTY_B,
        organizationId: ORG,
        name: 'One-click B',
        slug: 'one-click-unsubscribe-b',
        timezone: 'UTC',
      },
    ])
    const seeds = [
      {
        emailId: EMAIL_A,
        notificationId: '85000000-0000-4000-8000-000000000101',
        propertyId: PROPERTY_A,
        category: 'workflow_collaboration',
      },
      {
        emailId: EMAIL_B,
        notificationId: '85000000-0000-4000-8000-000000000102',
        propertyId: PROPERTY_B,
        category: 'recognition',
      },
      {
        emailId: EMAIL_MANDATORY,
        notificationId: '85000000-0000-4000-8000-000000000103',
        propertyId: null,
        category: 'mandatory',
      },
    ] as const
    await db.insert(notifications).values(
      seeds.map((seed) => ({
        id: seed.notificationId,
        userId: USER,
        organizationId: ORG,
        propertyId: seed.propertyId,
        type: 'review.created',
        category: seed.category,
        priority: 'normal',
        status: 'unread',
        resourceType:
          seed.category === 'mandatory' ? ('organization' as const) : 'inbox_item',
        resourceId: `one-click-${seed.emailId}`,
        eventId: `one-click-event-${seed.emailId}`,
        title: 'Notification',
        payload: {},
        createdAt: NOW,
        updatedAt: NOW,
      })),
    )
    await db.insert(notificationEmailQueue).values(
      seeds.map((seed) => ({
        id: seed.emailId,
        notificationId: seed.notificationId,
        userId: USER,
        organizationId: ORG,
        propertyId: seed.propertyId,
        category: seed.category,
        cadence: seed.category === 'mandatory' ? 'immediate' : 'daily',
        status: 'accepted',
        priority: 'normal',
        idempotencyKey: `one-click-${seed.emailId}`,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    )
    await db.insert(notificationPreferences).values({
      id: '85000000-0000-4000-8000-000000000201',
      userId: USER,
      organizationId: ORG,
      propertyId: PROPERTY_A,
      category: 'workflow_collaboration',
      channel: 'email',
      enabled: true,
      cadence: 'immediate',
      urgentBypassEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
      updatedAt: new Date('2026-08-20T10:00:00.000Z'),
    })
    await db.insert(notificationDigestBatches).values({
      id: BATCH,
      organizationId: ORG,
      userId: USER,
      localDate: '2026-08-26',
      sequence: 1,
      memberDigest: 'a'.repeat(64),
      contentDigest: 'b'.repeat(64),
      providerIdempotencyKey: 'one-click-unsubscribe-batch',
      unsubscribeKeyVersion: 'v1',
      state: 'accepted',
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(notificationDigestBatchMembers).values([
      {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        notificationEmailId: EMAIL_A,
        sortIndex: 0,
        createdAt: NOW,
      },
      {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        notificationEmailId: EMAIL_B,
        sortIndex: 1,
        createdAt: NOW,
      },
      {
        batchId: BATCH,
        organizationId: ORG,
        userId: USER,
        notificationEmailId: EMAIL_MANDATORY,
        sortIndex: 2,
        createdAt: NOW,
      },
    ])
  })

  afterAll(async () => {
    await db
      ?.delete(notificationDigestBatches)
      .where(eq(notificationDigestBatches.id, BATCH))
    await db
      ?.delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db?.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db?.delete(properties).where(eq(properties.organizationId, ORG))
    await lease?.release()
  })

  it('mutes every optional scope in an immutable digest and preserves existing settings', async () => {
    const repo = createOneClickUnsubscribeRepository(db)

    await expect(repo.apply({ kind: 'digest', id: BATCH }, NOW)).resolves.toBe(2)

    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.organizationId, ORG),
          eq(notificationPreferences.userId, USER),
          eq(notificationPreferences.channel, 'email'),
        ),
      )
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyId: PROPERTY_A,
          category: 'workflow_collaboration',
          enabled: false,
          cadence: 'immediate',
          urgentBypassEnabled: true,
          quietHoursStart: '22:00:00',
          quietHoursEnd: '07:00:00',
        }),
        expect.objectContaining({
          propertyId: PROPERTY_B,
          category: 'recognition',
          enabled: false,
          cadence: 'daily',
          urgentBypassEnabled: false,
        }),
      ]),
    )
  })

  it('is idempotent for an urgent row and refuses to create a mandatory opt-out', async () => {
    const repo = createOneClickUnsubscribeRepository(db)

    await expect(repo.apply({ kind: 'email', id: EMAIL_A }, NOW)).resolves.toBe(1)
    await expect(repo.apply({ kind: 'email', id: EMAIL_MANDATORY }, NOW)).resolves.toBe(0)
    const mandatory = await db
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.organizationId, ORG),
          inArray(notificationPreferences.category, ['mandatory']),
        ),
      )
    expect(mandatory).toEqual([])
  })

  it('treats a valid capability whose retained target is gone as a neutral no-op', async () => {
    const repo = createOneClickUnsubscribeRepository(db)

    await expect(
      repo.apply({ kind: 'email', id: '85000000-0000-4000-8000-000000000099' }, NOW),
    ).resolves.toBe(0)
  })
})
