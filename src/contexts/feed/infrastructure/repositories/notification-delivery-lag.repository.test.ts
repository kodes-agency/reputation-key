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
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { mandatoryRepeatEmailKey } from '../../application/use-cases/insert-notification'
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
/** Generous for these small reads; the timeout suite pins the cancellation. */
const STATEMENT_TIMEOUT_MS = 10_000

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
    const repo = createNotificationDeliveryLagRepository(db, () => true)
    const report = await repo.read({
      recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
      recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
      scanLimit: 10,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
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
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
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
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      }),
    ).rejects.toThrow('scanLimit must be a positive integer')
    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 1001,
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      }),
    ).rejects.toThrow('scanLimit must not exceed 1000')
    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T08:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 10,
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      }),
    ).rejects.toThrow('recordedAtOrAfter must precede recordedBefore')
    await expect(
      repo.read({
        recordedAtOrAfter: new Date('2026-08-27T07:00:00.000Z'),
        recordedBefore: new Date('2026-08-27T07:55:00.000Z'),
        scanLimit: 10,
        statementTimeoutMs: 0,
      }),
    ).rejects.toThrow('statementTimeoutMs must be a positive integer')

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
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
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

// ── A mandatory repeat's email is timed from its own event ──────────────
//
// A second role change coalesces into the first one's unread row and anchors
// its email there, but that email exists because of the second event. Timed
// from the row's (first) event, it would read as minutes or days late and
// trip the five-minute acceptance alert on the day it went out on time.
const REPEAT_ORG = organizationId('notification-delivery-lag-repeat-org')
const REPEAT_USER = 'notification-delivery-lag-repeat-user'
const REPEAT_NOTIFICATION = '86000000-0000-4000-8000-000000000001'
const ROLE_EVENTS = {
  first: { id: '86000000-0000-4000-8000-000000000011', at: '2026-08-29T07:00:00.000Z' },
  accepted: {
    id: '86000000-0000-4000-8000-000000000012',
    at: '2026-08-29T07:30:00.000Z',
  },
  awaiting: {
    id: '86000000-0000-4000-8000-000000000013',
    at: '2026-08-29T07:40:00.000Z',
  },
} as const

describe.sequential(
  'notification delivery lag for mandatory repeats (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const clearScope = async () => {
      await db
        .delete(notificationEmailQueue)
        .where(eq(notificationEmailQueue.organizationId, REPEAT_ORG))
      await db.delete(notifications).where(eq(notifications.organizationId, REPEAT_ORG))
      await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, REPEAT_ORG))
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      await clearScope()
      await db.insert(outboxEvents).values(
        Object.values(ROLE_EVENTS).map((event) => ({
          id: event.id,
          eventType: 'identity.member.role_changed',
          eventVersion: 1,
          payload: { memberUserId: REPEAT_USER },
          organizationId: REPEAT_ORG,
          propertyId: null,
          sourceContext: 'identity',
          sourceAggregateId: REPEAT_USER,
          createdAt: new Date(event.at),
          publishedAt: new Date(event.at),
        })),
      )
      await db.insert(notifications).values({
        id: REPEAT_NOTIFICATION,
        userId: REPEAT_USER,
        organizationId: REPEAT_ORG,
        propertyId: null,
        type: 'account.organization_role_changed',
        category: 'mandatory',
        priority: 'normal',
        status: 'unread',
        resourceType: 'organization',
        resourceId: REPEAT_ORG,
        eventId: ROLE_EVENTS.first.id,
        title: 'Role changed',
        payload: {},
        coalescedCount: 3,
        createdAt: new Date(ROLE_EVENTS.first.at),
        updatedAt: new Date(ROLE_EVENTS.awaiting.at),
      })
      const email = (
        id: string,
        idempotencyKey: string,
        createdAt: string,
        acceptedAt: string | null,
      ) => ({
        id,
        notificationId: REPEAT_NOTIFICATION,
        userId: REPEAT_USER,
        organizationId: REPEAT_ORG,
        propertyId: null,
        category: 'mandatory',
        cadence: 'immediate',
        status: acceptedAt === null ? 'pending' : 'accepted',
        priority: 'normal',
        idempotencyKey,
        attemptedAt: acceptedAt === null ? null : new Date(acceptedAt),
        acceptedAt: acceptedAt === null ? null : new Date(acceptedAt),
        createdAt: new Date(createdAt),
        updatedAt: new Date(acceptedAt ?? createdAt),
      })
      await db.insert(notificationEmailQueue).values([
        // The row's own email, for the event that created it: 30 s.
        email(
          '86000000-0000-4000-9000-000000000001',
          `${REPEAT_NOTIFICATION}:email`,
          '2026-08-29T07:00:05.000Z',
          '2026-08-29T07:00:30.000Z',
        ),
        // The second role change's email: 60 s from its own event.
        email(
          '86000000-0000-4000-9000-000000000002',
          mandatoryRepeatEmailKey(ROLE_EVENTS.accepted.id, REPEAT_USER),
          '2026-08-29T07:30:05.000Z',
          '2026-08-29T07:31:00.000Z',
        ),
        // The third one's email is still waiting on the provider.
        email(
          '86000000-0000-4000-9000-000000000003',
          mandatoryRepeatEmailKey(ROLE_EVENTS.awaiting.id, REPEAT_USER),
          '2026-08-29T07:40:05.000Z',
          null,
        ),
      ])
    })

    afterAll(async () => {
      if (db) await clearScope()
      await lease?.release()
    })

    it('measures each repeat email from the event that queued it', async () => {
      const report = await createNotificationDeliveryLagRepository(db, () => true).read({
        recordedAtOrAfter: new Date('2026-08-29T06:00:00.000Z'),
        recordedBefore: new Date('2026-08-29T08:00:00.000Z'),
        scanLimit: 10,
        statementTimeoutMs: 2_000,
      })

      expect(report.immediateEmailAcceptance).toEqual({
        awaitingProviderAcceptance: 1,
        attemptedAwaitingProviderAcceptance: 0,
        oldestAwaitingSourceRecordedAt: new Date(ROLE_EVENTS.awaiting.at),
        acceptedLatencyP99Ms: 60_000,
        acceptedSampleCount: 2,
        sourceUnlinked: 0,
        saturated: false,
      })
    })
  },
)

// The five-minute acceptance target only means something where email may be
// sent. An Organization whose `notification.send_email` capability is denied
// (not allowlisted, suspended, killed) still gets pending immediate rows, and
// nothing will ever attempt them.
const SCOPE_WINDOW_START = new Date('2026-08-28T07:00:00.000Z')
const SCOPE_WINDOW_END = new Date('2026-08-28T07:55:00.000Z')
const ALLOWED_ORG = organizationId('notification-delivery-lag-allowed-org')
const DARK_ORG = organizationId('notification-delivery-lag-dark-org')
const ALLOWED_PROPERTY = propertyId('84000000-0000-4000-8000-000000000001')
const DARK_PROPERTY = propertyId('84000000-0000-4000-8000-000000000002')
const ALLOWED_ACCEPTED_SOURCE = '84000000-0000-4000-8000-000000000010'
const ALLOWED_REAUTH_SOURCE = '84000000-0000-4000-8000-000000000011'
const DARK_PENDING_SOURCE = '84000000-0000-4000-8000-000000000012'
const ALLOWED_ACCEPTED_NOTIFICATION = '84000000-0000-4000-8000-000000000020'
const ALLOWED_REAUTH_NOTIFICATION = '84000000-0000-4000-8000-000000000021'
const DARK_PENDING_NOTIFICATION = '84000000-0000-4000-8000-000000000022'
const ALLOWED_ACCEPTED_SOURCE_RECORDED = new Date('2026-08-28T07:48:00.000Z')
const ALLOWED_REAUTH_SOURCE_RECORDED = new Date('2026-08-28T07:40:00.000Z')
const DARK_PENDING_SOURCE_RECORDED = new Date('2026-08-28T07:10:00.000Z')

describe.sequential(
  'notification email acceptance by delivery scope (real PostgreSQL)',
  () => {
    let lease: TestLease
    let db: Database

    const cleanup = async () => {
      for (const org of [ALLOWED_ORG, DARK_ORG]) {
        await db
          ?.delete(notificationEmailQueue)
          .where(eq(notificationEmailQueue.organizationId, org))
        await db?.delete(notifications).where(eq(notifications.organizationId, org))
        await db?.delete(outboxEvents).where(eq(outboxEvents.organizationId, org))
        await db?.delete(properties).where(eq(properties.organizationId, org))
      }
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      await cleanup()
      await db.insert(properties).values([
        {
          id: ALLOWED_PROPERTY,
          organizationId: ALLOWED_ORG,
          name: 'Email Allowed Property',
          slug: 'notification-delivery-lag-allowed',
          timezone: 'UTC',
        },
        {
          id: DARK_PROPERTY,
          organizationId: DARK_ORG,
          name: 'Email Dark Property',
          slug: 'notification-delivery-lag-dark',
          timezone: 'UTC',
        },
      ])
      await db.insert(outboxEvents).values([
        {
          id: ALLOWED_ACCEPTED_SOURCE,
          eventType: 'review.reply.publish_failed',
          eventVersion: 1,
          payload: {},
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          sourceContext: 'review',
          sourceAggregateId: '84000000-0000-4000-8000-000000000030',
          createdAt: ALLOWED_ACCEPTED_SOURCE_RECORDED,
          publishedAt: ALLOWED_ACCEPTED_SOURCE_RECORDED,
        },
        {
          // An Organization-level source: the Google account is not a Property,
          // though its notice is anchored to one.
          id: ALLOWED_REAUTH_SOURCE,
          eventType: 'integration.google_account.reauthorization_required',
          eventVersion: 1,
          payload: {},
          organizationId: ALLOWED_ORG,
          propertyId: null,
          sourceContext: 'integration',
          sourceAggregateId: '84000000-0000-4000-8000-000000000031',
          createdAt: ALLOWED_REAUTH_SOURCE_RECORDED,
          publishedAt: ALLOWED_REAUTH_SOURCE_RECORDED,
        },
        {
          id: DARK_PENDING_SOURCE,
          eventType: 'review.reply.publish_failed',
          eventVersion: 1,
          payload: {},
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          sourceContext: 'review',
          sourceAggregateId: '84000000-0000-4000-8000-000000000032',
          createdAt: DARK_PENDING_SOURCE_RECORDED,
          publishedAt: DARK_PENDING_SOURCE_RECORDED,
        },
      ])
      await db.insert(notifications).values([
        {
          id: ALLOWED_ACCEPTED_NOTIFICATION,
          userId: 'lag-scope-user',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          type: 'reply.publish_failed',
          category: 'urgent_operational',
          priority: 'urgent',
          status: 'unread',
          resourceType: 'inbox_item',
          resourceId: ALLOWED_ACCEPTED_NOTIFICATION,
          eventId: ALLOWED_ACCEPTED_SOURCE,
          title: 'Accepted in an allowed scope',
          payload: {},
          createdAt: ALLOWED_ACCEPTED_SOURCE_RECORDED,
          updatedAt: ALLOWED_ACCEPTED_SOURCE_RECORDED,
        },
        {
          id: ALLOWED_REAUTH_NOTIFICATION,
          userId: 'lag-scope-user',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          type: 'integration.reauthorization_required',
          category: 'urgent_operational',
          priority: 'urgent',
          status: 'unread',
          resourceType: 'property',
          resourceId: ALLOWED_PROPERTY,
          eventId: ALLOWED_REAUTH_SOURCE,
          title: 'Reauthorization in an allowed scope',
          payload: {},
          createdAt: ALLOWED_REAUTH_SOURCE_RECORDED,
          updatedAt: ALLOWED_REAUTH_SOURCE_RECORDED,
        },
        {
          id: DARK_PENDING_NOTIFICATION,
          userId: 'lag-scope-user',
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          type: 'reply.publish_failed',
          category: 'urgent_operational',
          priority: 'urgent',
          status: 'unread',
          resourceType: 'inbox_item',
          resourceId: DARK_PENDING_NOTIFICATION,
          eventId: DARK_PENDING_SOURCE,
          title: 'Pending in a capability-dark scope',
          payload: {},
          createdAt: DARK_PENDING_SOURCE_RECORDED,
          updatedAt: DARK_PENDING_SOURCE_RECORDED,
        },
      ])
      await db.insert(notificationEmailQueue).values([
        {
          notificationId: ALLOWED_ACCEPTED_NOTIFICATION,
          userId: 'lag-scope-user',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          category: 'urgent_operational',
          cadence: 'immediate',
          status: 'accepted',
          priority: 'urgent',
          idempotencyKey: 'lag-scope-allowed-accepted',
          attemptedAt: new Date('2026-08-28T07:49:00.000Z'),
          acceptedAt: new Date('2026-08-28T07:49:00.000Z'),
          createdAt: ALLOWED_ACCEPTED_SOURCE_RECORDED,
          updatedAt: new Date('2026-08-28T07:49:00.000Z'),
        },
        {
          notificationId: ALLOWED_REAUTH_NOTIFICATION,
          userId: 'lag-scope-user',
          organizationId: ALLOWED_ORG,
          propertyId: ALLOWED_PROPERTY,
          category: 'urgent_operational',
          cadence: 'immediate',
          status: 'pending',
          priority: 'urgent',
          idempotencyKey: 'lag-scope-allowed-reauth',
          createdAt: ALLOWED_REAUTH_SOURCE_RECORDED,
          updatedAt: ALLOWED_REAUTH_SOURCE_RECORDED,
        },
        {
          notificationId: DARK_PENDING_NOTIFICATION,
          userId: 'lag-scope-user',
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          category: 'urgent_operational',
          cadence: 'immediate',
          status: 'pending',
          priority: 'urgent',
          idempotencyKey: 'lag-scope-dark-pending',
          createdAt: DARK_PENDING_SOURCE_RECORDED,
          updatedAt: DARK_PENDING_SOURCE_RECORDED,
        },
      ])
    })

    afterAll(async () => {
      await cleanup()
      await lease?.release()
    })

    it('judges only scopes where email may send, and links Organization-level sources', async () => {
      const asked: Array<{ organizationId: string; propertyId: string | null }> = []
      const repo = createNotificationDeliveryLagRepository(db, (scope) => {
        asked.push(scope)
        return scope.organizationId === ALLOWED_ORG
      })

      const report = await repo.read({
        recordedAtOrAfter: SCOPE_WINDOW_START,
        recordedBefore: SCOPE_WINDOW_END,
        scanLimit: 10,
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      })

      // The dark Organization's untouched pending row is not an acceptance
      // candidate; the allowed reauthorization row is, with its source clock.
      expect(report.immediateEmailAcceptance).toEqual({
        awaitingProviderAcceptance: 1,
        attemptedAwaitingProviderAcceptance: 0,
        oldestAwaitingSourceRecordedAt: ALLOWED_REAUTH_SOURCE_RECORDED,
        acceptedLatencyP99Ms: 60_000,
        acceptedSampleCount: 1,
        sourceUnlinked: 0,
        saturated: false,
      })
      expect(asked).toContainEqual({
        organizationId: DARK_ORG,
        propertyId: DARK_PROPERTY,
      })
      expect(asked).toContainEqual({
        organizationId: ALLOWED_ORG,
        propertyId: ALLOWED_PROPERTY,
      })
    })

    it('bounds its scan by sendable rows, so a dark backlog can neither saturate nor crowd it', async () => {
      // Newer than every allowed row: a newest-first scan meets them first.
      const darkBacklog = [
        {
          notificationId: '84000000-0000-4000-8000-000000000040',
          createdAt: new Date('2026-08-28T07:52:00.000Z'),
        },
        {
          notificationId: '84000000-0000-4000-8000-000000000041',
          createdAt: new Date('2026-08-28T07:50:00.000Z'),
        },
      ]
      await db.insert(notifications).values(
        darkBacklog.map(({ notificationId, createdAt }) => ({
          id: notificationId,
          userId: 'lag-scope-user',
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          type: 'reply.publish_failed',
          category: 'urgent_operational',
          priority: 'urgent',
          status: 'unread',
          resourceType: 'inbox_item',
          resourceId: notificationId,
          eventId: DARK_PENDING_SOURCE,
          title: 'Pending in a capability-dark scope',
          payload: {},
          createdAt,
          updatedAt: createdAt,
        })),
      )
      await db.insert(notificationEmailQueue).values(
        darkBacklog.map(({ notificationId, createdAt }) => ({
          notificationId,
          userId: 'lag-scope-user',
          organizationId: DARK_ORG,
          propertyId: DARK_PROPERTY,
          category: 'urgent_operational',
          cadence: 'immediate',
          status: 'pending',
          priority: 'urgent',
          idempotencyKey: `lag-scope-dark-backlog-${notificationId}`,
          createdAt,
          updatedAt: createdAt,
        })),
      )
      const window = {
        recordedAtOrAfter: SCOPE_WINDOW_START,
        recordedBefore: SCOPE_WINDOW_END,
      }

      // Two sendable rows fit a two-row bound whatever the dark scope holds.
      const allowed = createNotificationDeliveryLagRepository(
        db,
        (scope) => scope.organizationId === ALLOWED_ORG,
      )
      const bounded = await allowed.read({
        ...window,
        scanLimit: 2,
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      })
      expect(bounded.immediateEmailAcceptance).toEqual({
        awaitingProviderAcceptance: 1,
        attemptedAwaitingProviderAcceptance: 0,
        oldestAwaitingSourceRecordedAt: ALLOWED_REAUTH_SOURCE_RECORDED,
        acceptedLatencyP99Ms: 60_000,
        acceptedSampleCount: 1,
        sourceUnlinked: 0,
        saturated: false,
      })

      // Email dark everywhere: nothing to judge, and nothing saturated.
      const dark = createNotificationDeliveryLagRepository(db, () => false)
      const quiet = await dark.read({
        ...window,
        scanLimit: 1,
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      })
      expect(quiet.immediateEmailAcceptance).toEqual({
        awaitingProviderAcceptance: 0,
        attemptedAwaitingProviderAcceptance: 0,
        oldestAwaitingSourceRecordedAt: null,
        acceptedLatencyP99Ms: null,
        acceptedSampleCount: 0,
        sourceUnlinked: 0,
        saturated: false,
      })
    })
  },
)

// Each immediate email is linked to its durable source by outbox event id.
// Joined as `source_event.id::text = notification.event_id`, the uuid primary
// key could not serve the join: with the email⋈notification join estimated at
// one row, the planner walked the Organization's whole outbox for every email
// (loops = emails × that Organization's events) — seconds at a few hundred
// emails, past the health section's budget, so the signal degraded and every
// alert reading it went blind exactly when volume was highest.
const PLAN_ORG_PREFIX = 'notification-delivery-lag-plan-org-'
const PLAN_ORG_COUNT = 20
const PLAN_EVENTS_PER_ORG = 12_000
const PLAN_LINKED_EMAILS = 500
const PLAN_ORG = organizationId(`${PLAN_ORG_PREFIX}0`)
const PLAN_PROPERTY = propertyId('85000000-0000-4000-8000-000000000001')
const PLAN_WINDOW_END = new Date('2026-08-29T08:00:00.000Z')
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/**
 * Event ids that are not uuids. Each must read as unlinked — never reach the
 * `::uuid` cast, which would throw and fail the whole signal: 36 dashes and a
 * uuid-shaped id with a non-hex digit pass a loose character-class guard.
 */
const UNLINKABLE_EVENT_IDS = [
  '-'.repeat(36),
  'not-an-outbox-event-id',
  '85000000-0000-4000-8000-00000000000g',
]

type PlanNode = Readonly<{ [key: string]: unknown; Plans?: readonly PlanNode[] }>
const planNodes = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(planNodes),
]

describe.sequential('immediate-email source linkage at volume (real PostgreSQL)', () => {
  // Written inside one held transaction and rolled back: 240k outbox rows are
  // never committed, and the ANALYZE that gives the planner production-like
  // statistics is rolled back with them.
  let fixture: HeldTransaction | undefined
  const statements: Array<Readonly<{ query: string; params: unknown[] }>> = []

  beforeAll(async () => {
    fixture = await holdTransaction({
      logger: { logQuery: (query, params) => statements.push({ query, params }) },
    })
    const { client } = fixture
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Delivery Lag Plan Property', 'notification-delivery-lag-plan', 'UTC')`,
      [PLAN_PROPERTY, PLAN_ORG],
    )
    // Thirty days of unrelated outbox history for each of twenty Organizations.
    await client.query(
      `INSERT INTO outbox_events (
         event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id, created_at, published_at
       )
       SELECT 'ops.delivery-lag-plan.filler', 1, '{}'::jsonb,
         $1::text || (n % $2::int)::text, NULL, 'ops', 'delivery-lag-plan-filler',
         $3::timestamptz - (n / $2::int) * ($4::int * INTERVAL '1 millisecond'),
         $3::timestamptz - (n / $2::int) * ($4::int * INTERVAL '1 millisecond')
       FROM generate_series(0, $5::int - 1) AS n`,
      [
        PLAN_ORG_PREFIX,
        PLAN_ORG_COUNT,
        PLAN_WINDOW_END,
        (30 * DAY_MS) / PLAN_EVENTS_PER_ORG,
        PLAN_ORG_COUNT * PLAN_EVENTS_PER_ORG,
      ],
    )
    // One Organization's urgent notices, each emailed immediately and linked
    // to its routed source fact.
    await client.query(
      `WITH source AS (
         INSERT INTO outbox_events (
           event_type, event_version, payload, organization_id, property_id,
           source_context, source_aggregate_id, created_at, published_at
         )
         SELECT 'review.reply.publish_failed', 1, '{}'::jsonb, $1::text, $2::text,
           'review', 'delivery-lag-plan-source-' || n,
           $3::timestamptz - n * INTERVAL '1 minute',
           $3::timestamptz - n * INTERVAL '1 minute'
         FROM generate_series(1, $4::int) AS n
         RETURNING id::text AS event_id, created_at
       ),
       notice AS (
         INSERT INTO notifications (
           user_id, organization_id, property_id, type, category, priority, status,
           resource_type, resource_id, event_id, title, payload, created_at, updated_at
         )
         SELECT 'delivery-lag-plan-user', $1::text, $5::uuid, 'reply.publish_failed',
           'urgent_operational', 'urgent', 'unread', 'inbox_item', gen_random_uuid()::text,
           source.event_id, 'Linked at volume', '{}'::jsonb, source.created_at, source.created_at
         FROM source
         RETURNING id, created_at
       )
       INSERT INTO notification_email_queue (
         notification_id, user_id, organization_id, property_id, category, cadence,
         status, priority, idempotency_key, created_at, updated_at
       )
       SELECT notice.id, 'delivery-lag-plan-user', $1::text, $5::uuid, 'urgent_operational',
         'immediate', 'pending', 'urgent', 'delivery-lag-plan-' || notice.id,
         notice.created_at, notice.created_at
       FROM notice`,
      [PLAN_ORG, PLAN_PROPERTY, PLAN_WINDOW_END, PLAN_LINKED_EMAILS, PLAN_PROPERTY],
    )
    await client.query(
      `WITH notice AS (
         INSERT INTO notifications (
           user_id, organization_id, property_id, type, category, priority, status,
           resource_type, resource_id, event_id, title, payload, created_at, updated_at
         )
         SELECT 'delivery-lag-plan-user', $1::text, $2::uuid, 'reply.publish_failed',
           'urgent_operational', 'urgent', 'unread', 'inbox_item', gen_random_uuid()::text,
           unlinkable.event_id, 'Unlinkable event id', '{}'::jsonb,
           $3::timestamptz - INTERVAL '1 hour', $3::timestamptz - INTERVAL '1 hour'
         FROM unnest($4::text[]) AS unlinkable(event_id)
         RETURNING id, created_at
       )
       INSERT INTO notification_email_queue (
         notification_id, user_id, organization_id, property_id, category, cadence,
         status, priority, idempotency_key, created_at, updated_at
       )
       SELECT notice.id, 'delivery-lag-plan-user', $1::text, $2::uuid, 'urgent_operational',
         'immediate', 'pending', 'urgent', 'delivery-lag-plan-unlinkable-' || notice.id,
         notice.created_at, notice.created_at
       FROM notice`,
      [PLAN_ORG, PLAN_PROPERTY, PLAN_WINDOW_END, UNLINKABLE_EVENT_IDS],
    )
    await client.query('ANALYZE outbox_events, notifications, notification_email_queue')
  }, 120_000)

  afterAll(async () => {
    await fixture?.rollBack()
  })

  it("links each email to its source by the outbox primary key, not a walk of its Organization's outbox", async () => {
    const repo = createNotificationDeliveryLagRepository(fixture!.db, () => true)
    statements.length = 0

    const report = await repo.read({
      recordedAtOrAfter: new Date(PLAN_WINDOW_END.getTime() - DAY_MS),
      recordedBefore: PLAN_WINDOW_END,
      scanLimit: 1000,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    })

    // Every linked email found its source; each unlinkable id is unlinked.
    expect(report.immediateEmailAcceptance).toMatchObject({
      awaitingProviderAcceptance: PLAN_LINKED_EMAILS + UNLINKABLE_EVENT_IDS.length,
      oldestAwaitingSourceRecordedAt: new Date(
        PLAN_WINDOW_END.getTime() - PLAN_LINKED_EMAILS * MINUTE_MS,
      ),
      sourceUnlinked: UNLINKABLE_EVENT_IDS.length,
      saturated: false,
    })
    const linkage = statements.find(({ query }) => query.includes('source_event'))
    expect(linkage).toBeDefined()
    const explained = await fixture!.client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
      `EXPLAIN (FORMAT JSON) ${linkage!.query}`,
      linkage!.params,
    )
    const sourceScans = planNodes(explained.rows[0]!['QUERY PLAN'][0].Plan).filter(
      (node) => node.Alias === 'source_event',
    )
    expect(sourceScans.map((node) => node['Index Name'] ?? node['Node Type'])).toEqual([
      'outbox_events_pkey',
    ])
  }, 60_000)
})
