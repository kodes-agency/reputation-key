import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNotificationDeliveryLagRepository } from './notification-delivery-lag.repository'

const ORG = organizationId('notification-delivery-lag-org')
const PROPERTY = propertyId('83000000-0000-4000-8000-000000000001')
const SOURCE_PENDING = '83000000-0000-4000-8000-000000000002'
const MATERIALIZATION_PENDING = '83000000-0000-4000-8000-000000000003'
const UNRELATED_ENQUEUE = '83000000-0000-4000-8000-000000000004'
const ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000005'
const PENDING_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000006'
const SECOND_ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000007'
const HELD_ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000008'
const ORGANIZATION_ACCEPTED_EMAIL_SOURCE = '83000000-0000-4000-8000-000000000009'
const ACCEPTED_NOTIFICATION = '83000000-0000-4000-8000-000000000020'
const PENDING_NOTIFICATION = '83000000-0000-4000-8000-000000000021'
const UNLINKED_NOTIFICATION = '83000000-0000-4000-8000-000000000022'
const SECOND_ACCEPTED_NOTIFICATION = '83000000-0000-4000-8000-000000000023'
const HELD_ACCEPTED_NOTIFICATION = '83000000-0000-4000-8000-000000000024'
const ORGANIZATION_ACCEPTED_NOTIFICATION = '83000000-0000-4000-8000-000000000025'
const ACCEPTED_EMAIL = '83000000-0000-4000-8000-000000000030'
const PENDING_EMAIL = '83000000-0000-4000-8000-000000000031'
const UNLINKED_EMAIL = '83000000-0000-4000-8000-000000000032'
const SECOND_ACCEPTED_EMAIL = '83000000-0000-4000-8000-000000000033'
const HELD_ACCEPTED_EMAIL = '83000000-0000-4000-8000-000000000034'
const ORGANIZATION_ACCEPTED_EMAIL = '83000000-0000-4000-8000-000000000035'
const RECORDED = new Date('2026-08-27T07:50:00.000Z')
const ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:48:00.000Z')
const PENDING_SOURCE_RECORDED = new Date('2026-08-27T07:49:00.000Z')
const SECOND_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:47:00.000Z')
const HELD_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:40:00.000Z')
const ORGANIZATION_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-27T07:46:00.000Z')

describe.sequential('notification delivery lag report (real PostgreSQL)', () => {
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
      name: 'Lag Report Property',
      slug: 'notification-delivery-lag',
      timezone: 'UTC',
    })
    await db.insert(outboxEvents).values([
      {
        id: SOURCE_PENDING,
        eventType: 'inbox.inbox_item.assigned',
        eventVersion: 1,
        payload: { private: 'must-never-be-selected' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'inbox',
        sourceAggregateId: '83000000-0000-4000-8000-000000000010',
        createdAt: RECORDED,
        publishedAt: RECORDED,
      },
      {
        id: MATERIALIZATION_PENDING,
        eventType: 'inbox.inbox_item.assigned',
        eventVersion: 1,
        payload: { private: 'must-never-be-selected' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'inbox',
        sourceAggregateId: '83000000-0000-4000-8000-000000000011',
        createdAt: RECORDED,
        publishedAt: RECORDED,
      },
      {
        id: UNRELATED_ENQUEUE,
        eventType: 'metric.corrected',
        eventVersion: 1,
        payload: { private: 'also-must-never-be-selected' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'metric',
        sourceAggregateId: '83000000-0000-4000-8000-000000000012',
        createdAt: RECORDED,
        publishedAt: RECORDED,
      },
      {
        id: ACCEPTED_EMAIL_SOURCE,
        eventType: 'review.reply.publish_failed',
        eventVersion: 1,
        payload: { private: 'must-never-enter-email-health' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: '83000000-0000-4000-8000-000000000013',
        createdAt: ACCEPTED_SOURCE_RECORDED,
        publishedAt: ACCEPTED_SOURCE_RECORDED,
      },
      {
        id: PENDING_EMAIL_SOURCE,
        eventType: 'review.reply.publish_failed',
        eventVersion: 1,
        payload: { private: 'must-never-enter-email-health' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: '83000000-0000-4000-8000-000000000014',
        createdAt: PENDING_SOURCE_RECORDED,
        publishedAt: PENDING_SOURCE_RECORDED,
      },
      {
        id: SECOND_ACCEPTED_EMAIL_SOURCE,
        eventType: 'review.reply.publish_failed',
        eventVersion: 1,
        payload: { private: 'must-never-enter-email-health' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: '83000000-0000-4000-8000-000000000015',
        createdAt: SECOND_ACCEPTED_SOURCE_RECORDED,
        publishedAt: SECOND_ACCEPTED_SOURCE_RECORDED,
      },
      {
        id: HELD_ACCEPTED_EMAIL_SOURCE,
        eventType: 'review.reply.publish_failed',
        eventVersion: 1,
        payload: { private: 'held-content-must-never-enter-email-health' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'review',
        sourceAggregateId: '83000000-0000-4000-8000-000000000016',
        createdAt: HELD_ACCEPTED_SOURCE_RECORDED,
        publishedAt: HELD_ACCEPTED_SOURCE_RECORDED,
      },
      {
        id: ORGANIZATION_ACCEPTED_EMAIL_SOURCE,
        eventType: 'identity.member.removed',
        eventVersion: 1,
        payload: { memberUserId: 'notification-account-user' },
        organizationId: ORG,
        propertyId: null,
        sourceContext: 'identity',
        sourceAggregateId: 'notification-account-user',
        createdAt: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
        publishedAt: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
      },
    ])
    await db.insert(notifications).values([
      {
        id: ACCEPTED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.publish_failed',
        category: 'urgent_operational',
        priority: 'urgent',
        status: 'unread',
        resourceType: 'inbox_item',
        resourceId: ACCEPTED_NOTIFICATION,
        eventId: ACCEPTED_EMAIL_SOURCE,
        title: 'Accepted email evidence',
        payload: {},
        createdAt: ACCEPTED_SOURCE_RECORDED,
        updatedAt: ACCEPTED_SOURCE_RECORDED,
      },
      {
        id: PENDING_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.publish_failed',
        category: 'urgent_operational',
        priority: 'urgent',
        status: 'unread',
        resourceType: 'inbox_item',
        resourceId: PENDING_NOTIFICATION,
        eventId: PENDING_EMAIL_SOURCE,
        title: 'Pending email evidence',
        payload: {},
        createdAt: PENDING_SOURCE_RECORDED,
        updatedAt: PENDING_SOURCE_RECORDED,
      },
      {
        id: UNLINKED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.publish_failed',
        category: 'urgent_operational',
        priority: 'urgent',
        status: 'unread',
        resourceType: 'inbox_item',
        resourceId: UNLINKED_NOTIFICATION,
        eventId: '83000000-0000-4000-8000-000000000099',
        title: 'Unlinked email evidence',
        payload: {},
        createdAt: RECORDED,
        updatedAt: RECORDED,
      },
      {
        id: SECOND_ACCEPTED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.publish_failed',
        category: 'urgent_operational',
        priority: 'urgent',
        status: 'unread',
        resourceType: 'inbox_item',
        resourceId: SECOND_ACCEPTED_NOTIFICATION,
        eventId: SECOND_ACCEPTED_EMAIL_SOURCE,
        title: 'Second accepted email evidence',
        payload: {},
        createdAt: SECOND_ACCEPTED_SOURCE_RECORDED,
        updatedAt: SECOND_ACCEPTED_SOURCE_RECORDED,
      },
      {
        id: HELD_ACCEPTED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        type: 'reply.publish_failed',
        category: 'urgent_operational',
        priority: 'urgent',
        status: 'unread',
        resourceType: 'inbox_item',
        resourceId: HELD_ACCEPTED_NOTIFICATION,
        eventId: HELD_ACCEPTED_EMAIL_SOURCE,
        title: 'Policy-held accepted email evidence',
        payload: {},
        createdAt: HELD_ACCEPTED_SOURCE_RECORDED,
        updatedAt: HELD_ACCEPTED_SOURCE_RECORDED,
      },
      {
        id: ORGANIZATION_ACCEPTED_NOTIFICATION,
        userId: 'notification-account-user',
        organizationId: ORG,
        propertyId: null,
        type: 'account.organization_access_removed',
        category: 'mandatory',
        priority: 'normal',
        status: 'unread',
        resourceType: 'organization',
        resourceId: ORG,
        eventId: ORGANIZATION_ACCEPTED_EMAIL_SOURCE,
        title: 'Organization account evidence',
        payload: {},
        createdAt: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
        updatedAt: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
      },
    ])
    await db.insert(notificationEmailQueue).values([
      {
        id: ACCEPTED_EMAIL,
        notificationId: ACCEPTED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'immediate',
        status: 'accepted',
        priority: 'urgent',
        idempotencyKey: 'notification-email-accepted',
        attemptedAt: new Date('2026-08-27T07:51:00.000Z'),
        acceptedAt: new Date('2026-08-27T07:51:00.000Z'),
        createdAt: ACCEPTED_SOURCE_RECORDED,
        updatedAt: new Date('2026-08-27T07:51:00.000Z'),
      },
      {
        id: PENDING_EMAIL,
        notificationId: PENDING_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'immediate',
        status: 'failed',
        priority: 'urgent',
        idempotencyKey: 'notification-email-pending',
        lastErrorClass: 'transient',
        attemptedAt: RECORDED,
        nextAttemptAt: new Date('2026-08-27T07:54:00.000Z'),
        retryCount: 1,
        createdAt: PENDING_SOURCE_RECORDED,
        updatedAt: RECORDED,
      },
      {
        id: UNLINKED_EMAIL,
        notificationId: UNLINKED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'immediate',
        status: 'pending',
        priority: 'urgent',
        idempotencyKey: 'notification-email-unlinked',
        createdAt: RECORDED,
        updatedAt: RECORDED,
      },
      {
        id: SECOND_ACCEPTED_EMAIL,
        notificationId: SECOND_ACCEPTED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'immediate',
        status: 'accepted',
        priority: 'urgent',
        idempotencyKey: 'notification-email-second-accepted',
        attemptedAt: new Date('2026-08-27T07:48:00.000Z'),
        acceptedAt: new Date('2026-08-27T07:48:00.000Z'),
        createdAt: SECOND_ACCEPTED_SOURCE_RECORDED,
        updatedAt: new Date('2026-08-27T07:48:00.000Z'),
      },
      {
        id: HELD_ACCEPTED_EMAIL,
        notificationId: HELD_ACCEPTED_NOTIFICATION,
        userId: 'notification-email-user',
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'urgent_operational',
        cadence: 'immediate',
        status: 'accepted',
        priority: 'urgent',
        idempotencyKey: 'notification-email-held-accepted',
        // This hold is deliberately retained after acceptance. Its fourteen-
        // minute source-to-acceptance interval must not enter the immediate
        // five-minute target or it would manufacture a quiet-hours breach.
        notBefore: new Date('2026-08-27T07:53:00.000Z'),
        attemptedAt: new Date('2026-08-27T07:54:00.000Z'),
        acceptedAt: new Date('2026-08-27T07:54:00.000Z'),
        createdAt: HELD_ACCEPTED_SOURCE_RECORDED,
        updatedAt: new Date('2026-08-27T07:54:00.000Z'),
      },
      {
        id: ORGANIZATION_ACCEPTED_EMAIL,
        notificationId: ORGANIZATION_ACCEPTED_NOTIFICATION,
        userId: 'notification-account-user',
        organizationId: ORG,
        propertyId: null,
        category: 'mandatory',
        cadence: 'immediate',
        status: 'accepted',
        priority: 'normal',
        idempotencyKey: 'notification-email-organization-accepted',
        attemptedAt: new Date('2026-08-27T07:47:00.000Z'),
        acceptedAt: new Date('2026-08-27T07:47:00.000Z'),
        createdAt: ORGANIZATION_ACCEPTED_SOURCE_RECORDED,
        updatedAt: new Date('2026-08-27T07:47:00.000Z'),
      },
    ])
    await db.insert(eventConsumerReceipts).values([
      {
        eventId: ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        status: 'applied',
        createdAt: new Date('2026-08-27T07:50:30.000Z'),
      },
      {
        eventId: PENDING_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        status: 'applied',
        createdAt: RECORDED,
      },
      {
        eventId: SECOND_ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        status: 'applied',
        createdAt: new Date('2026-08-27T07:47:30.000Z'),
      },
      {
        eventId: HELD_ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-review-reply-publish_failed',
        status: 'applied',
        createdAt: new Date('2026-08-27T07:41:00.000Z'),
      },
      {
        eventId: ORGANIZATION_ACCEPTED_EMAIL_SOURCE,
        consumerName: 'notification.on-identity-member-removed',
        status: 'applied',
        createdAt: new Date('2026-08-27T07:46:30.000Z'),
      },
      {
        eventId: MATERIALIZATION_PENDING,
        consumerName: 'notification.on-inbox-inbox_item-assigned',
        status: 'applied',
        createdAt: RECORDED,
      },
      {
        eventId: UNRELATED_ENQUEUE,
        consumerName: 'notification.enqueue:notification.on-retired-family:abc123',
        status: 'applied',
        createdAt: RECORDED,
      },
      {
        eventId: MATERIALIZATION_PENDING,
        consumerName:
          'notification.enqueue:notification.on-inbox-inbox_item-assigned:abc123',
        status: 'applied',
        createdAt: RECORDED,
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

  it('installs the partial provider-acceptance scan index in PostgreSQL', async () => {
    const result = await lease.pool.query<{ indexdef: string }>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'notification_email_queue'
        AND indexname = 'notification_email_queue_immediate_acceptance_health_idx'
    `)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.indexdef).toMatch(/\(created_at DESC[^,]*, id\)/u)
    expect(result.rows[0]?.indexdef).toMatch(
      /WHERE .*cadence.*=.*'immediate'.*not_before IS NULL/iu,
    )
  })

  it('reports bounded lag, excludes retained policy holds, and exposes no payloads', async () => {
    const repo = createNotificationDeliveryLagRepository(db)
    const report = await repo.read({
      recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
      recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
      scanLimit: 10,
    })

    expect(report).toEqual({
      sourceReceiptPending: 1,
      materializationPending: 1,
      oldestSourceRecordedAt: RECORDED,
      oldestMaterializationSourceRecordedAt: RECORDED,
      oldestMaterializationEnqueuedAt: RECORDED,
      sourceSaturated: false,
      materializationSaturated: false,
      immediateEmailAcceptance: {
        awaitingProviderAcceptance: 2,
        attemptedAwaitingProviderAcceptance: 1,
        oldestAwaitingSourceRecordedAt: PENDING_SOURCE_RECORDED,
        acceptedLatencyP99Ms: 180_000,
        acceptedSampleCount: 3,
        sourceUnlinked: 1,
        saturated: false,
      },
    })
    expect(JSON.stringify(report)).not.toContain('must-never-be-selected')
    expect(JSON.stringify(report)).not.toContain('also-must-never-be-selected')
    expect(JSON.stringify(report)).not.toContain(
      'held-content-must-never-enter-email-health',
    )

    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 1,
      }),
    ).resolves.toMatchObject({
      sourceReceiptPending: 1,
      materializationPending: 1,
      sourceSaturated: true,
      materializationSaturated: true,
      immediateEmailAcceptance: expect.objectContaining({
        acceptedLatencyP99Ms: null,
        saturated: true,
      }),
    })
    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 0,
      }),
    ).rejects.toThrow('scanLimit must be a positive integer')
    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 1001,
      }),
    ).rejects.toThrow('scanLimit must not exceed 1000')
    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T08:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 10,
      }),
    ).rejects.toThrow('recordedAtOrAfter must precede recordedBefore')

    await db.insert(eventConsumerReceipts).values([
      {
        eventId: SOURCE_PENDING,
        consumerName: 'notification.on-inbox-inbox_item-assigned',
        status: 'applied',
        createdAt: RECORDED,
      },
      {
        eventId: MATERIALIZATION_PENDING,
        consumerName:
          'notification.materialized:notification.on-inbox-inbox_item-assigned:abc123',
        status: 'applied',
        createdAt: RECORDED,
      },
    ])

    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 10,
      }),
    ).resolves.toEqual({
      sourceReceiptPending: 0,
      materializationPending: 0,
      oldestSourceRecordedAt: null,
      oldestMaterializationSourceRecordedAt: null,
      oldestMaterializationEnqueuedAt: null,
      sourceSaturated: false,
      materializationSaturated: false,
      immediateEmailAcceptance: {
        awaitingProviderAcceptance: 2,
        attemptedAwaitingProviderAcceptance: 1,
        oldestAwaitingSourceRecordedAt: PENDING_SOURCE_RECORDED,
        acceptedLatencyP99Ms: 180_000,
        acceptedSampleCount: 3,
        sourceUnlinked: 1,
        saturated: false,
      },
    })
  })
})
