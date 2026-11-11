import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { identityMemberRoleChanged } from '#/contexts/identity/domain/events'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
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
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createNoticeWriter } from '../notify/consumers.server'
import { createNotificationFeedReads } from '../application/notification-feed-reads'
import { waitingWorkState } from './jobs/test-fixtures'
import {
  currentRouteDeps,
  dispatch,
} from '#/shared/testing/notification-route-test-harness'
import { createNotificationRepository } from './repositories/notification.repository'

const ORG_A = organizationId('notification-acceptance-a')
const ORG_B = organizationId('notification-acceptance-b')
const SHARED_USER = userId('notification-acceptance-shared')
const OTHER_USER = userId('notification-acceptance-other')
const ORGANIZATIONS = [ORG_A, ORG_B]
const NOW = new Date('2026-09-02T09:00:00.000Z')

describe.sequential(
  'notification acceptance through producers, dispatcher and PostgreSQL',
  () => {
    let lease: TestLease
    let db: Database

    async function clearDeliveries() {
      await db
        .delete(notificationEmailQueue)
        .where(inArray(notificationEmailQueue.organizationId, ORGANIZATIONS))
      await db
        .delete(notifications)
        .where(inArray(notifications.organizationId, ORGANIZATIONS))
      // Receipts belong to their source and cascade with it.
      await db
        .delete(outboxEvents)
        .where(inArray(outboxEvents.organizationId, ORGANIZATIONS))
    }

    beforeAll(async () => {
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      db = drizzle(lease.pool) as Database
      registerAllEventSchemas()
      await seedOrgs(lease.pool, ORGANIZATIONS)
    })
    beforeEach(async () => {
      await clearDeliveries()
      initCapabilityPolicyStore(
        createEnvCapabilityPolicyStore({ BETA_ALLOWLIST_ORGS: ORGANIZATIONS.join(',') }),
      )
      initDelayedExecutionPolicy(
        createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
      )
    })
    afterEach(() => {
      resetDelayedExecutionPolicy()
      resetCapabilityPolicyStore()
    })
    afterAll(async () => {
      try {
        if (db) await clearDeliveries()
        if (lease) await deleteTestOrganizations(lease.pool, ORGANIZATIONS)
      } finally {
        await lease?.release()
      }
    })

    const factFor = (organizationId: OrganizationId, recipient: UserId = SHARED_USER) =>
      identityMemberRoleChanged({
        organizationId,
        memberUserId: recipient,
        userId: userId('notification-acceptance-actor'),
        previousRole: 'PropertyManager',
        newRole: 'AccountAdmin',
        occurredAt: NOW,
      })

    function realWriter() {
      const deps = currentRouteDeps()
      return createNoticeWriter({
        db,
        clock: () => NOW,
        idGen: () => notificationId(randomUUID()),
        emailIdGen: () => notificationEmailId(randomUUID()),
        logger: deps.logger,
        ratingForRouting: async () => null,
        // Identity reads are outside this persistence proof; every fixture is eligible.
        authorizeAudience: async () => true,
        workState: waitingWorkState(),
      })
    }

    async function produce(
      organization: OrganizationId,
      recipient: UserId = SHARED_USER,
    ) {
      const fact = factFor(organization, recipient)
      const [source] = await db
        .insert(outboxEvents)
        .values({
          id: fact.eventId,
          ...toOutboxEvent(fact),
          createdAt: NOW,
        })
        .returning()
      const envelope = buildConsumerEvent({
        ...source!,
        recordedAt: source!.createdAt,
      })
      const outbox = createOutboxRepository(db)
      const result = await dispatch(fact, currentRouteDeps(), {
        outbox,
        envelope,
        noticeWriter: realWriter(),
      })
      expect(result.gateDenials).toEqual([])
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.eventId, fact.eventId))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        userId: recipient,
        organizationId: organization,
        propertyId: null,
        type: 'account.organization_role_changed',
      })
      return { fact, row: rows[0]! }
    }

    it('redelivery preserves one notice, one email intent and the durable receipts', async () => {
      const { fact, row } = await produce(ORG_A)
      const outbox = createOutboxRepository(db)
      await dispatch(fact, currentRouteDeps(), {
        outbox,
        noticeWriter: realWriter(),
      })

      const stored = await db
        .select()
        .from(notifications)
        .where(eq(notifications.eventId, fact.eventId))
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        id: row.id,
        category: 'mandatory',
        coalescedCount: 1,
      })
      const emails = await db
        .select()
        .from(notificationEmailQueue)
        .where(eq(notificationEmailQueue.notificationId, row.id))
      expect(emails).toHaveLength(1)
      const receipts = await db
        .select()
        .from(eventConsumerReceipts)
        .where(eq(eventConsumerReceipts.eventId, fact.eventId))
      expect(receipts.map(({ consumerName }) => consumerName)).toEqual([
        'notification.on-identity-member-role-changed',
      ])
    })

    it('isolates head, pages, counts and bulk mutations for the same user in two Organizations', async () => {
      const a = await produce(ORG_A)
      const b = await produce(ORG_B)
      const other = await produce(ORG_A, OTHER_USER)
      const reads = createNotificationFeedReads({
        repo: createNotificationRepository(db),
        propertyAccess: async () => null,
        clock: () => NOW,
      })
      const ctx = {
        organizationId: ORG_A,
        userId: SHARED_USER,
        role: 'AccountAdmin',
      } as const
      const head = await reads.getFeedHead(ctx, { filter: 'all', limit: 20 })
      expect(head.page.notifications.map(({ id }) => id)).toEqual([a.row.id])
      expect(head.unreadCount).toBe(1)
      expect(head.filterUnreadCount).toBe(1)
      const page = await reads.getNotifications(ctx, {
        filter: 'all',
        limit: 20,
        before: null,
      })
      expect(page.notifications.map(({ id }) => id)).toEqual([a.row.id])

      const statuses = async () => {
        const rows = await db
          .select({ id: notifications.id, status: notifications.status })
          .from(notifications)
          .where(
            and(
              inArray(notifications.organizationId, ORGANIZATIONS),
              inArray(notifications.id, [a.row.id, b.row.id, other.row.id]),
            ),
          )
        return Object.fromEntries(rows.map(({ id, status }) => [id, status]))
      }
      await reads.markAllRead(ctx, 'all')
      expect(await statuses()).toEqual({
        [a.row.id]: 'read',
        [b.row.id]: 'unread',
        [other.row.id]: 'unread',
      })
      await reads.dismissAll(ctx)
      expect(await statuses()).toEqual({
        [a.row.id]: 'dismissed',
        [b.row.id]: 'unread',
        [other.row.id]: 'unread',
      })
    })
  },
)
