// Outbox delivery end-to-end proof (real PostgreSQL + real BullMQ/Redis).
//
// fallow-ignore-file boundary-violation
// This cross-context integration proof deliberately wires the real Review and
// Inbox command stores and repositories to the shared outbox runtime. The
// integration project discovers it through the infrastructure/repositories
// glob, so no single context can own the file.
//
// Against a scratch database and local Redis, the suite records real outbox
// facts, invokes createOutboxRelay(...).poll() directly, and dispatches them on
// a real BullMQ Worker running createDispatcherHandler. It proves that:
//
//   - a backlog committed before relay polling is drained exactly once;
//   - an exact current review.reply.observed fact closes Inbox work, while its
//     receipt makes explicit redelivery a no-op; and
//   - rebuildInboxProjection reports a missing live Review projection in dry
//     run mode before repairing it without disturbing an observed closure.
//
// Relay polling is invoked directly rather than by interval. Worker completion
// is awaited through bounded receipt polling, queues are unique per process,
// and clocks are fixed at each delivery boundary.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  reviewId,
  inboxItemId,
  type InboxItemId,
} from '#/shared/domain/ids'
import { createOutboxRelay, type OutboxRelay } from '#/shared/outbox/relay'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import {
  createConsumerRegistry,
  type ConsumerRegistry,
} from '#/shared/outbox/consumer-registry'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import { resetDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import type { PolicyStoreHandle } from '#/contexts/identity/infrastructure/policy-store-init'
import { reviewCreated } from '#/contexts/review/domain/events'
import type { Review } from '#/contexts/review/domain/types'
import { createAtomicReviewCommandStore } from '#/contexts/review/infrastructure/review-command-store'
import { createGoogleReplyObservationStore } from '#/contexts/review/infrastructure/google-reply-observation-store'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'
import { createReviewReplyObservationAuthority } from '#/contexts/review/infrastructure/reply-observation-authority'
import { createReviewSourceTransitionAuthority } from '#/contexts/review/infrastructure/source-transition-authority'
import { createReviewResponseTargetAuthority } from '#/contexts/review/infrastructure/response-target-authority'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import { createInboxRepository } from '#/contexts/inbox/infrastructure/repositories/inbox.repository'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/inbox/infrastructure/inbox-command-store'
import { createReviewHandlingCycleStore } from '#/contexts/inbox/infrastructure/review-handling-cycle.store'
import { createReviewSourceLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/review-source-lookup.adapter'
import { createReplyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-lookup.adapter'
import { registerInboxConsumers } from '#/contexts/inbox/infrastructure/outbox-consumers'
import { createReplyObservationAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-observation-authority.adapter'
import { createSourceTransitionAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/source-transition-authority.adapter'
import { createReviewResponseTargetAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/review-response-target-authority.adapter'
import { rebuildInboxProjection } from '#/contexts/inbox/application/use-cases/rebuild-inbox-projection'
import { createInboxItem as buildInboxItem } from '#/contexts/inbox/domain/constructors'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '#/contexts/inbox/application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '#/contexts/inbox/application/ports/review-source-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'

let consumerRegistry: ConsumerRegistry = createConsumerRegistry()

const EVENTS_QUEUE = `outbox-delivery-events-${process.pid}`

const ORG = organizationId('4e000000-0000-4000-8000-0000000000a1')
const PROP = propertyId('4e000000-0000-4000-8000-0000000000b1')
const OBSERVED_REVIEW = reviewId('4e000000-0000-4000-8000-0000000000c1')
const REPAIR_REVIEW = reviewId('4e000000-0000-4000-8000-0000000000c2')
const BACKLOG = 12
const backlogReviewIds = Array.from({ length: BACKLOG }, (_, i) =>
  reviewId(`4e000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`),
)

const REVIEWED_AT = new Date('2026-07-01T12:00:00.000Z')
const OBSERVED_AT = new Date('2026-07-04T12:00:00.000Z')
const REPAIR_REVIEWED_AT = new Date('2026-07-05T12:00:00.000Z')
const REBUILD_AT = new Date('2026-07-06T12:00:00.000Z')

const CREATED_CONSUMER = 'inbox.on-review-created'
const OBSERVED_CONSUMER = 'inbox.on-reply-observed'

const db = getDb()
const outboxRepo = createOutboxRepository(db)
let pool: Pool
let redisLease: RedisTestLease | undefined
let redisAvailable = false
let eventsQueue: Queue | undefined
let worker: Worker | undefined
let relay: OutboxRelay | undefined
let policyHandle: PolicyStoreHandle | undefined

let idCounter = 0
const idGen = (): InboxItemId =>
  inboxItemId(`4e000000-0000-4000-8000-0000000002${String(++idCounter).padStart(2, '0')}`)

let consumerNow = REVIEWED_AT

const allowAllInboxCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

function makeReview(id: string, reviewedAt: Date, externalId: string): Review {
  return {
    id: reviewId(id),
    organizationId: ORG,
    propertyId: PROP,
    platform: 'google',
    externalId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Synthetic outbox review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt,
    expiresAt: new Date('2027-07-01T00:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: reviewedAt,
    sourceUpdatedAt: null,
    firstFetchedAt: reviewedAt,
    lastFetchedAt: reviewedAt,
    contentExpiresAt: new Date('2027-07-01T00:00:00.000Z'),
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
  }
}

function makeReviewLookup(): ReviewLookupPort {
  const reviewRepo = createReviewRepository(db, () => new Date())
  return {
    getReviewSnippetById: async (id, orgId): Promise<ReviewSnippetResult> => {
      const row = await reviewRepo.findById(id, orgId)
      if (!row) return { status: 'not_found' }
      return {
        status: 'available',
        snippet: {
          reviewerName: row.reviewerName,
          text: null,
          translatedText: null,
          reviewerProfilePhotoUrl: null,
          rating: row.rating,
          languageCode: row.languageCode,
        },
      }
    },
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [],
  }
}

const stubEnrichmentPorts = {
  reviewLookup: {
    getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
      status: 'not_found',
    }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [] as string[],
  },
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  },
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  },
}

function makeReviewSourceLookup(): ReviewSourceLookupPort {
  const reviewRepo = createReviewRepository(db, () => new Date())
  return createReviewSourceLookupAdapter({
    findById: (id, orgId) => reviewRepo.findById(id, orgId),
    findByIds: (ids, orgId) => reviewRepo.findByIds(ids, orgId),
    findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
    findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
  })
}

function makeReplyLookup() {
  const replyRepo = createReplyRepository(db, () => new Date())
  return createReplyLookupAdapter({
    findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
    findMilestonesByReviewIds: (ids, orgId) =>
      replyRepo.findMilestonesByReviewIds(ids, orgId),
  })
}

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : null

type ProjectionSnapshot =
  | Readonly<{ exists: false }>
  | Readonly<{
      exists: true
      status: string
      sourceDate: string | null
      platform: string | null
      firstReplySubmittedAt: string | null
      firstReplyPublishedAt: string | null
      closedAt: string | null
    }>

async function projectionSnapshot(sourceId: string): Promise<ProjectionSnapshot> {
  const result = await pool.query(
    `SELECT status, source_date, platform,
            first_reply_submitted_at, first_reply_published_at, closed_at
       FROM inbox_items WHERE organization_id = $1 AND source_id = $2`,
    [ORG, sourceId],
  )
  if (result.rows.length === 0) return { exists: false }
  const row = result.rows[0] as Record<string, unknown>
  return {
    exists: true,
    status: row.status as string,
    sourceDate: iso(row.source_date),
    platform: (row.platform as string | null) ?? null,
    firstReplySubmittedAt: iso(row.first_reply_submitted_at),
    firstReplyPublishedAt: iso(row.first_reply_published_at),
    closedAt: iso(row.closed_at),
  }
}

async function waitForReceipts(
  eventIds: ReadonlyArray<string>,
  consumer: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now()
  for (;;) {
    const result = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM event_consumer_receipts
        WHERE consumer_name = $1 AND event_id = ANY($2)`,
      [consumer, [...eventIds]],
    )
    const count = result.rows[0]?.n ?? 0
    if (count >= eventIds.length) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${eventIds.length} receipt(s) from ${consumer} (got ${count})`,
      )
    }
    // BullMQ/Redis progresses outside Vitest's clock, so fake timers cannot drive it.
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 50)
    await promise
  }
}

async function receiptsFor(eventId: string): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    'SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1',
    [eventId],
  )
  return result.rows as Array<Record<string, unknown>>
}

async function redeliver(eventId: string, eventType: string): Promise<void> {
  const result = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [eventId])
  const row = result.rows[0] as Record<string, unknown>
  const envelope = buildConsumerEvent({
    id: row.id as string,
    eventType: row.event_type as string,
    eventVersion: row.event_version as number,
    payload: row.payload,
    organizationId: row.organization_id as string,
    propertyId: (row.property_id as string | null) ?? null,
    sourceContext: row.source_context as string,
    sourceAggregateId: row.source_aggregate_id as string,
    recordedAt: row.created_at as Date,
  })
  const handler = createDispatcherHandler(outboxRepo, { consumers: consumerRegistry })
  await handler({ id: eventId, name: eventType, data: envelope } as unknown as Job)
}

async function itemsFor(sourceId: string): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT id, status, source_date, closed_at,
            first_reply_submitted_at, first_reply_published_at
       FROM inbox_items WHERE organization_id = $1 AND source_id = $2`,
    [ORG, sourceId],
  )
  return result.rows as Array<Record<string, unknown>>
}

async function seedOpenItem(source: string, sourceDate: Date): Promise<void> {
  const store = createAtomicInboxCommandStore(
    db,
    allowAllInboxCommandAuthority,
    () => sourceDate,
  )
  const built = buildInboxItem({
    id: idGen(),
    organizationId: ORG,
    propertyId: PROP,
    sourceType: 'review',
    sourceId: reviewId(source),
    sourceDate,
    platform: 'google',
    assignedTo: null,
    clock: () => sourceDate,
  })
  if (built.isErr()) throw built.error
  await store.createItem(built.value, null, { materialReviewRevision: 1 })
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()

  clearEventSchemas()
  registerAllEventSchemas()

  await pool.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM google_reply_observation_heads WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM google_reply_observations WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM reply_publication_attempts WHERE organization_id = $1', [
    ORG,
  ])
  await withPublicationAuthorizationFixtureMutation(() =>
    pool.query(
      'DELETE FROM reply_publication_authorizations WHERE organization_id = $1',
      [ORG],
    ),
  )
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])

  // The production relay claims globally. Remove pending facts before creating
  // this suite's closed-world backlog, without touching published history.
  await pool.query('DELETE FROM outbox_events WHERE published_at IS NULL')
  await pool.query(
    `DELETE FROM inbox_items
      WHERE id::text LIKE '4e000000-0000-4000-8000-0000000002%'`,
  )

  redisLease = await acquireRedisTestLease()
  redisAvailable = redisLease.available
  const redis = redisLease.redis
  if (!redisAvailable || !redis) return

  const connection = redis as unknown as ConnectionOptions
  eventsQueue = new Queue(EVENTS_QUEUE, { connection })
  try {
    await eventsQueue.obliterate({ force: true })
  } catch {
    // The queue may not exist yet.
  }

  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  policyHandle = initPersistedCapabilityPolicyStore({
    db,
    env: {} as CapabilityPolicyEnv,
    clock: () => new Date(),
    logger: { warn: () => {} },
  })
  bindProcessPolicies(policyHandle)

  consumerRegistry = createConsumerRegistry()
  registerInboxConsumers(consumerRegistry, {
    commandStore: createAtomicInboxCommandStore(
      db,
      allowAllInboxCommandAuthority,
      () => consumerNow,
    ),
    handlingCycleStore: createReviewHandlingCycleStore(db),
    replyObservationAuthority: createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(db),
    ),
    responseTargetAuthority: createReviewResponseTargetAuthorityAdapter(
      createReviewResponseTargetAuthority(db),
    ),
    sourceTransitionAuthority: createSourceTransitionAuthorityAdapter(
      createReviewSourceTransitionAuthority(db),
    ),
    reviewLookup: makeReviewLookup(),
    reviewSourceLookup: makeReviewSourceLookup(),
    inboxRepo: createInboxRepository(db, stubEnrichmentPorts, {
      clock: () => consumerNow,
      logger: noopLogger,
    }),
    idGen,
    clock: () => consumerNow,
    logger: noopLogger,
  })

  worker = new Worker(
    EVENTS_QUEUE,
    createDispatcherHandler(outboxRepo, { consumers: consumerRegistry }),
    {
      connection,
      concurrency: 4,
    },
  )
  await worker.waitUntilReady()
  relay = createOutboxRelay(outboxRepo, eventsQueue)

  const conflictingOrganizations = await pool.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = 'outbox-delivery-proof' AND id <> $1`,
    [ORG],
  )
  await deleteTestOrganizations(
    pool,
    conflictingOrganizations.rows.map(({ id }) => id),
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Outbox Delivery Proof Org', 'outbox-delivery-proof', NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Outbox Delivery Property', 'outbox-delivery-prop', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP, ORG],
  )
})

afterAll(async () => {
  await worker?.close()
  try {
    await eventsQueue?.obliterate({ force: true })
  } catch {
    // best-effort
  }
  await eventsQueue?.close()
  redisLease?.release()
  policyHandle?.stopPolling()
  releaseProcessPolicies()
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  consumerRegistry = createConsumerRegistry()

  if (pool) {
    await pool.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
    await pool.query(
      'DELETE FROM google_reply_observation_heads WHERE organization_id = $1',
      [ORG],
    )
    await pool.query('DELETE FROM google_reply_observations WHERE organization_id = $1', [
      ORG,
    ])
    await pool.query(
      'DELETE FROM reply_publication_attempts WHERE organization_id = $1',
      [ORG],
    )
    await withPublicationAuthorizationFixtureMutation(() =>
      pool.query(
        'DELETE FROM reply_publication_authorizations WHERE organization_id = $1',
        [ORG],
      ),
    )
    await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
    // Consumer receipts cascade from their source rows.
    await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM properties WHERE id = $1', [PROP])
    await deleteTestOrganizations(pool, [ORG])
    await pool.end()
  }
  clearEventSchemas()
})

describe.sequential('outbox delivery end-to-end proof', () => {
  it('drains a recorded backlog exactly once', async () => {
    if (!redisAvailable || !relay) return
    const activeRelay = relay
    const reviewStore = createAtomicReviewCommandStore(db, () => new Date())
    const backlogEventIds: string[] = []

    for (let i = 0; i < BACKLOG; i++) {
      const rid = backlogReviewIds[i]!
      const event = reviewCreated({
        reviewId: rid,
        propertyId: PROP,
        organizationId: ORG,
        platform: 'google',
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 1,
        occurredAt: REVIEWED_AT,
      })
      await reviewStore.upsertAndRecord(
        makeReview(rid, REVIEWED_AT, `outbox-backlog-${i}`),
        event,
        REVIEWED_AT,
      )
      backlogEventIds.push(event.eventId)
    }

    for (let i = 0; i < BACKLOG; i++) {
      expect(await receiptsFor(backlogEventIds[i]!)).toHaveLength(0)
      expect(await itemsFor(backlogReviewIds[i]!)).toHaveLength(0)
    }

    consumerNow = REVIEWED_AT
    await activeRelay.poll()
    await waitForReceipts(backlogEventIds, CREATED_CONSUMER)

    for (let i = 0; i < BACKLOG; i++) {
      expect(await receiptsFor(backlogEventIds[i]!)).toEqual([
        { consumer_name: CREATED_CONSUMER, status: 'applied' },
      ])
      expect(await itemsFor(backlogReviewIds[i]!)).toHaveLength(1)
    }

    await redeliver(backlogEventIds[0]!, 'review.created')
    expect(await receiptsFor(backlogEventIds[0]!)).toHaveLength(1)
    expect(await itemsFor(backlogReviewIds[0]!)).toHaveLength(1)
  }, 60_000)

  it('closes work from an exact current reply observation exactly once', async () => {
    if (!redisAvailable || !relay) return
    const activeRelay = relay
    const reviewRepo = createReviewRepository(db, () => new Date())
    const savedReview = await reviewRepo.upsert(
      makeReview(OBSERVED_REVIEW, REVIEWED_AT, 'outbox-observed-review'),
    )
    expect(savedReview.sourceRevision).toBe(1)
    await seedOpenItem(OBSERVED_REVIEW, REVIEWED_AT)

    const observationStore = createGoogleReplyObservationStore(db)
    const observation = await observationStore.record({
      organizationId: ORG,
      propertyId: PROP,
      reviewId: OBSERVED_REVIEW,
      sourceEpoch: savedReview.sourceEpoch,
      materialReviewRevision: savedReview.sourceRevision,
      readGeneration: await observationStore.allocateReadGeneration(),
      observationKey: '3'.repeat(64),
      source: 'provider_snapshot',
      observedText: 'External current reply',
      providerUpdatedAt: OBSERVED_AT,
      observedAt: OBSERVED_AT,
      contentExpiresAt: new Date('2027-07-04T12:00:00.000Z'),
    })
    expect(observation).toMatchObject({
      observationRevision: 1,
      change: 'added',
      resolution: 'external_current_live',
      matchedReplyId: null,
      matchedPublicationCycle: null,
    })

    const observedFacts = await pool.query<{ id: string }>(
      `SELECT id FROM outbox_events
        WHERE organization_id = $1
          AND event_type = 'review.reply.observed'
          AND payload->>'reviewId' = $2`,
      [ORG, OBSERVED_REVIEW],
    )
    expect(observedFacts.rows).toHaveLength(1)
    const observedEvent = observedFacts.rows[0]
    if (!observedEvent) throw new Error('Expected one recorded reply observation fact')
    const observedEventId = observedEvent.id

    expect(await projectionSnapshot(OBSERVED_REVIEW)).toMatchObject({
      status: 'open',
      firstReplyPublishedAt: null,
      closedAt: null,
    })

    consumerNow = OBSERVED_AT
    await activeRelay.poll()
    await waitForReceipts([observedEventId], OBSERVED_CONSUMER)

    const deliveredProjection = await projectionSnapshot(OBSERVED_REVIEW)
    expect(deliveredProjection).toMatchObject({
      status: 'closed',
      firstReplyPublishedAt: OBSERVED_AT.toISOString(),
      closedAt: OBSERVED_AT.toISOString(),
    })

    await redeliver(observedEventId, 'review.reply.observed')
    expect(await projectionSnapshot(OBSERVED_REVIEW)).toEqual(deliveredProjection)
    expect(await receiptsFor(observedEventId)).toEqual([
      { consumer_name: OBSERVED_CONSUMER, status: 'applied' },
    ])
  }, 60_000)

  it('reports then repairs a missing live review projection', async () => {
    if (!redisAvailable || !relay) return
    const activeRelay = relay
    const reviewStore = createAtomicReviewCommandStore(db, () => new Date())
    const event = reviewCreated({
      reviewId: REPAIR_REVIEW,
      propertyId: PROP,
      organizationId: ORG,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: REPAIR_REVIEWED_AT,
    })
    await reviewStore.upsertAndRecord(
      makeReview(REPAIR_REVIEW, REPAIR_REVIEWED_AT, 'outbox-repair-review'),
      event,
      REPAIR_REVIEWED_AT,
    )

    consumerNow = REPAIR_REVIEWED_AT
    await activeRelay.poll()
    await waitForReceipts([event.eventId], CREATED_CONSUMER)
    expect(await projectionSnapshot(REPAIR_REVIEW)).toMatchObject({
      exists: true,
      status: 'open',
      sourceDate: REPAIR_REVIEWED_AT.toISOString(),
    })

    const observedProjection = await projectionSnapshot(OBSERVED_REVIEW)
    expect(observedProjection).toMatchObject({ status: 'closed' })

    const rebuild = rebuildInboxProjection({
      repo: createInboxRepository(db, stubEnrichmentPorts, {
        clock: () => REBUILD_AT,
        logger: noopLogger,
      }),
      commandStore: createAtomicInboxCommandStore(
        db,
        allowAllInboxCommandAuthority,
        () => REBUILD_AT,
      ),
      reviewSourceLookup: makeReviewSourceLookup(),
      replyLookup: makeReplyLookup(),
      idGen,
      clock: () => REBUILD_AT,
      logger: noopLogger,
    })

    await pool.query(
      'DELETE FROM inbox_items WHERE organization_id = $1 AND source_id = $2',
      [ORG, REPAIR_REVIEW],
    )

    const dryRun = await rebuild({ organizationId: ORG, dryRun: true })
    expect(dryRun).toMatchObject({
      created: 1,
      closed: 0,
      milestones: 0,
      dryRun: true,
    })
    expect(await projectionSnapshot(REPAIR_REVIEW)).toEqual({ exists: false })
    expect(await projectionSnapshot(OBSERVED_REVIEW)).toEqual(observedProjection)

    const report = await rebuild({ organizationId: ORG, dryRun: false })
    expect(report).toMatchObject({
      created: 1,
      closed: 0,
      milestones: 0,
      dryRun: false,
    })
    expect(await projectionSnapshot(REPAIR_REVIEW)).toMatchObject({
      exists: true,
      status: 'open',
      sourceDate: REPAIR_REVIEWED_AT.toISOString(),
    })
    expect(await projectionSnapshot(OBSERVED_REVIEW)).toEqual(observedProjection)
  }, 60_000)
})
