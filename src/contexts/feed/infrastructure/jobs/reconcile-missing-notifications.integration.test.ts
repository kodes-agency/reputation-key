// Feed notification surface — the missing-notification repair, end to end.
//
// Built through buildFeedContext's own wiring against PostgreSQL, because the
// defect was one: the sweep reached the durable delivery bridge with an event
// id no outbox row carries, so its enqueue receipt broke the receipts foreign
// key, its job could never settle, and every firing queued more of them. Here
// a real feedback item's durable delivery is lost after Redis accepted it; the
// sweep must repair it through the worker's own settlement, once, and must
// never re-announce a delivery that settled without a notification — a review
// whose only manager muted it, say.
//
// The window sits in 2031 so no other suite's facts or items fall inside it.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, JobsOptions, Queue } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  eventConsumerReceipts,
  inboxItems,
  notificationEmailQueue,
  notificationPreferences,
  notifications,
  outboxEvents,
  properties,
} from '#/shared/db/schema'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  portalId,
  propertyId,
  recentActivityEntryId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { inboxItemCreated } from '#/contexts/inbox/domain/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { operationalActionHistoryRecordId } from '../../domain/operational-action-history'
import { buildFeedContext } from '../../build'
import {
  createInsertNotificationHandler,
  type InsertNotificationJobData,
} from './insert-notification.job'

const ORG = organizationId('notification-repair-integration-org')
const PROPERTY = propertyId('86000000-0000-4000-8000-000000000001')
const PORTAL = portalId('86000000-0000-4000-8000-000000000002')
const MANAGER = userId('notification-repair-manager')
const NOW = new Date('2031-03-07T06:00:00.000Z')
const ARRIVED = new Date('2031-03-07T05:30:00.000Z')

type QueuedJob = Readonly<{ name: string; data: unknown; opts?: JobsOptions }>

/**
 * BullMQ as far as the sweep can observe it: a job id already held, in any
 * state, is a no-op add that returns the held job; a held job reports its
 * state and can be removed; a job that spent its attempts stays held in the
 * failed set. `jobs` is every job the queue accepted, in order.
 */
function recordingQueue() {
  const jobs: QueuedJob[] = []
  const held = new Map<string, Readonly<{ job: QueuedJob; state: string }>>()
  const queue = {
    add: vi.fn(async (name: string, data: unknown, opts?: JobsOptions) => {
      const holding = opts?.jobId ? held.get(opts.jobId) : undefined
      if (holding) return holding.job
      const job = opts === undefined ? { name, data } : { name, data, opts }
      if (opts?.jobId) held.set(opts.jobId, { job, state: 'waiting' })
      jobs.push(job)
      return job
    }),
    getJob: vi.fn(async (id: string) => {
      const holding = held.get(id)
      if (!holding) return undefined
      return {
        getState: async () => holding.state,
        remove: async () => {
          held.delete(id)
        },
      }
    }),
  }
  const exhaust = (id: string) => {
    const holding = held.get(id)
    if (holding) held.set(id, { ...holding, state: 'failed' })
  }
  return { queue: queue as unknown as Queue, jobs, exhaust }
}

describe.sequential('missing-notification repair through the Feed build', () => {
  let lease: TestLease
  let db: Database

  const cleanUp = async () => {
    await db
      .delete(notificationEmailQueue)
      .where(eq(notificationEmailQueue.organizationId, ORG))
    await db.delete(notifications).where(eq(notifications.organizationId, ORG))
    await db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.organizationId, ORG))
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
    await db.delete(inboxItems).where(eq(inboxItems.organizationId, ORG))
    await db.delete(properties).where(eq(properties.organizationId, ORG))
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    registerAllEventSchemas()
  })

  beforeEach(async () => {
    await cleanUp()
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
    )
  })

  afterAll(async () => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
    await cleanUp()
    await lease?.release()
  })

  /** The Feed build the worker composes, over this suite's database. */
  function buildFeed(queue: Queue) {
    let id = 0
    const logger = createMockLogger()
    return buildFeedContext({
      activity: {
        db,
        staffPublicApi: {} as StaffPublicApi,
        clock: () => NOW,
        logger,
        idGen: () => recentActivityEntryId(crypto.randomUUID()),
        operationalHistoryIdGen: () =>
          operationalActionHistoryRecordId(crypto.randomUUID()),
        operationalHistoryHoldIdGen: () => crypto.randomUUID(),
      },
      notification: {
        db,
        outboxRepo: createOutboxRepository(db),
        queue,
        clock: () => NOW,
        idGen: () => `86000000-0000-4000-9000-${String(++id).padStart(12, '0')}`,
        logger,
        responsibleManagers: {
          findForProperty: async () => [MANAGER],
          findForPortal: async () => [MANAGER],
          findForPortalGroup: async () => [MANAGER],
          isEligibleForProperty: async () => true,
        },
        feedbackPortalLookup: { findPortalId: async () => PORTAL },
        googleConnectionProperties: { findGoogleNotificationAnchor: async () => null },
        monthlyResultFacts: {
          findMonthlyResultNotificationFacts: async () => null,
          findMonthlyResultRevisionNotificationFacts: async () => null,
        },
        portalHealthLookup: { findPortalHealthNotificationFacts: async () => null },
      },
    })
  }

  /** The insert-notification worker as bootstrap assembles it. */
  function insertWorker(feed: ReturnType<typeof buildFeed>) {
    const delivery = feed.notification.delivery
    let id = 0
    return createInsertNotificationHandler({
      ...delivery.repos,
      clock: () => NOW,
      idGen: () => `86000000-0000-4000-a000-${String(++id).padStart(12, '0')}` as never,
      emailIdGen: () =>
        `86000000-0000-4000-b000-${String(++id).padStart(12, '0')}` as never,
      logger: createMockLogger(),
      authorizeAudience: delivery.authorizeAudience,
      deliverySettlement: delivery.deliverySettlement,
    })
  }

  /**
   * An Inbox item arrives: Inbox commits the item and its durable fact, and
   * the worker's dispatcher runs the Feed consumer, whose insert job Redis
   * accepts. Returns the fact and that job.
   */
  async function arriveAndDispatch(
    source: Readonly<{ type: 'feedback' | 'review'; id: string }>,
    item: string,
  ) {
    await db
      .insert(properties)
      .values({
        id: PROPERTY,
        organizationId: ORG,
        name: 'Repair Property',
        slug: `notification-repair-${item}`,
        timezone: 'UTC',
      })
      .onConflictDoNothing()
    await db.insert(inboxItems).values({
      id: item,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceType: source.type,
      sourceId: source.id,
      sourceDate: ARRIVED,
      ...(source.type === 'review' ? { platform: 'google' } : {}),
      createdAt: ARRIVED,
      updatedAt: ARRIVED,
    })
    const fact = inboxItemCreated({
      inboxItemId: inboxItemId(item),
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceType: source.type,
      sourceId: source.type === 'review' ? reviewId(source.id) : feedbackId(source.id),
      occurredAt: ARRIVED,
    })
    await db.insert(outboxEvents).values({
      ...toOutboxEvent(fact),
      id: fact.eventId,
      createdAt: ARRIVED,
      publishedAt: ARRIVED,
    })

    const original = recordingQueue()
    const registry = createConsumerRegistry()
    buildFeed(original.queue).notification.worker.registerOutboxConsumers(registry)
    const row = (
      await db.select().from(outboxEvents).where(eq(outboxEvents.id, fact.eventId))
    )[0]!
    await createDispatcherHandler(createOutboxRepository(db), { consumers: registry })({
      id: fact.eventId,
      name: row.eventType,
      data: buildConsumerEvent({
        id: row.id,
        eventType: row.eventType,
        eventVersion: row.eventVersion,
        payload: row.payload,
        organizationId: row.organizationId,
        propertyId: row.propertyId,
        sourceContext: row.sourceContext,
        sourceAggregateId: row.sourceAggregateId,
        recordedAt: row.createdAt,
      }),
    } as unknown as Job)

    const insertJobs = original.jobs.filter((job) => job.name === 'insert-notification')
    expect(insertJobs).toHaveLength(1)
    return { eventId: fact.eventId, job: insertJobs[0]! }
  }

  const sweep = (feed: ReturnType<typeof buildFeed>) =>
    feed.notification.delivery.reconcileMissingNotificationsHandler!({} as Job)

  const insertJobsOf = (jobs: readonly QueuedJob[]) =>
    jobs.filter((job) => job.name === 'insert-notification')

  it('repairs a delivery Redis lost, under the source fact’s own id, and only once', async () => {
    const { eventId } = await arriveAndDispatch(
      { type: 'feedback', id: '86000000-0000-4000-8000-000000000011' },
      '86000000-0000-4000-8000-000000000010',
    )
    // The insert job is gone before it ran (Redis lost it, or it was pruned
    // after exhausting its attempts): no notification, no materialization.
    const repair = recordingQueue()
    const feed = buildFeed(repair.queue)

    await sweep(feed)

    const repaired = insertJobsOf(repair.jobs)
    expect(repaired).toHaveLength(1)
    expect(repaired[0]!.data).toMatchObject({
      userId: MANAGER,
      type: 'feedback.created',
      eventId,
      delivery: { eventId, consumerName: 'notification.on-inbox-item-created' },
    })

    await insertWorker(feed)({
      data: repaired[0]!.data,
    } as Job<InsertNotificationJobData>)
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, ORG), eq(notifications.eventId, eventId)),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.userId).toBe(MANAGER)

    await sweep(feed)
    expect(insertJobsOf(repair.jobs)).toHaveLength(1)
  })

  it('queues a repair again after its own job dead-lettered, until it settles', async () => {
    const { eventId } = await arriveAndDispatch(
      { type: 'feedback', id: '86000000-0000-4000-8000-000000000031' },
      '86000000-0000-4000-8000-000000000030',
    )
    const repair = recordingQueue()
    const feed = buildFeed(repair.queue)
    await sweep(feed)
    const [first] = insertJobsOf(repair.jobs)
    // The repair job spent its attempts too; BullMQ keeps it in the failed set.
    repair.exhaust(first!.opts!.jobId!)

    await sweep(feed)

    const repaired = insertJobsOf(repair.jobs)
    expect(repaired.map((queued) => queued.opts?.jobId)).toEqual([
      first!.opts!.jobId,
      first!.opts!.jobId,
    ])
    await insertWorker(feed)({
      data: repaired[1]!.data,
    } as Job<InsertNotificationJobData>)
    await sweep(feed)
    expect(insertJobsOf(repair.jobs)).toHaveLength(2)
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, ORG), eq(notifications.eventId, eventId)),
      )
    expect(rows).toHaveLength(1)
  })

  it('never re-announces a delivery that settled without a notification', async () => {
    const { eventId, job } = await arriveAndDispatch(
      { type: 'review', id: '86000000-0000-4000-8000-000000000021' },
      '86000000-0000-4000-8000-000000000020',
    )
    // The Property's only manager muted new reviews in both channels, so the
    // worker settles the delivery and writes no notification.
    for (const channel of ['in_app', 'email'] as const) {
      await db.insert(notificationPreferences).values({
        id: crypto.randomUUID(),
        userId: MANAGER,
        organizationId: ORG,
        propertyId: PROPERTY,
        category: 'workflow_collaboration',
        channel,
        enabled: false,
        cadence: 'daily',
      })
    }
    const repair = recordingQueue()
    const feed = buildFeed(repair.queue)
    await insertWorker(feed)({ data: job.data } as Job<InsertNotificationJobData>)
    const materialized = await db
      .select()
      .from(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, eventId))
    expect(materialized.map((receipt) => receipt.consumerName)).toContainEqual(
      expect.stringMatching(/^notification\.materialized:/u),
    )

    await sweep(feed)

    expect(insertJobsOf(repair.jobs)).toEqual([])
    await expect(feed.publicApi.readMissingNotificationCount()).resolves.toBe(0)
  })
})
