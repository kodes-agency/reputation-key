// BQC-3.9 — durable cutover synthetic proof (real PostgreSQL + real BullMQ/Redis).
//
// fallow-ignore-file boundary-violation — this cross-context end-to-end proof
// BY DESIGN wires the real command stores/repositories of the review + inbox
// contexts against the shared outbox runtime (the same wiring the composition
// root performs); no single context's zone can own it, and the integration
// project discovers it via the infrastructure/repositories glob.
//
// The FINAL BQC-3 slice's core evidence (phase BQC-3 §3.9). Against a scratch
// DB + Redis this suite boots the REAL outbox relay and the REAL dispatcher
// (a BullMQ worker running createDispatcherHandler — the same wiring
// worker/index.ts performs when OUTBOX_DISPATCHER_ENABLED=true) and proves:
//
//   (a) DURABLE PATH END-TO-END — synthetic review.created / review.updated /
//       review.expired / review.reply.published facts produced through the
//       REAL atomic command stores are projected by the durable consumers to
//       EXACTLY the state the in-process bus handlers produce for the same
//       event (shadow compare — field names only, never content). Receipts
//       exist per consumer per event; dual delivery (bus + durable + an
//       explicit durable redelivery) cannot double effects (receipt fencing +
//       idempotent applyOnce); the external-effect dedup mechanism (BullMQ
//       jobId) is proven for the review-sync enqueue shape.
//   (b) BACKLOG DRAIN — N unpublished outbox rows recorded BEFORE the first
//       relay poll (the pre-dispatcher backlog) are each processed exactly
//       once.
//   (c) REPAIR — a corrupted projection heals via rebuildInboxProjection
//       (dry-run reports first, then the real run closes/re-stamps/creates).
//   (d) SWITCH MODE — with a family in 'switch' the bus handlers are not
//       registered (registration assertion) and the durable path ALONE
//       produces the projection (legacy retirement + durable-primary proof).
//
// Determinism: the relay's poll is invoked directly (never interval-driven);
// worker completion is awaited via bounded receipt polling; BullMQ queues are
// unique per process and obliterated up front; every clock is fixed so both
// paths stamp identical timestamps from the same event. Skips cleanly when
// Redis is unreachable (same convention as the BQC-3.6 quarantine suite).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createEventBus, type EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  inboxItemId,
  type InboxItemId,
} from '#/shared/domain/ids'
import { createOutboxRelay, type OutboxRelay } from '#/shared/outbox/relay'
import { createDispatcherHandler, clearConsumers } from '#/shared/outbox/dispatcher'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  compareInboxProjection,
  createShadowCompareCollector,
  type InboxProjectionSnapshot,
} from '#/shared/outbox/shadow-compare'
import type { CutoverFamily } from '#/shared/outbox/cutover-flags'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  resetCapabilityPolicyStore,
  type CapabilityPolicyEnv,
} from '#/shared/auth/beta-capabilities'
import { resetDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import {
  reviewCreated,
  reviewUpdated,
  reviewExpired,
  reviewReplyPublished,
} from '#/contexts/review/domain/events'
import type { Review, Reply } from '#/contexts/review/domain/types'
import { createAtomicReviewCommandStore } from '#/contexts/review/infrastructure/review-command-store'
import { createAtomicReplyCommandStore } from '#/contexts/review/infrastructure/reply-command-store'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import { createInboxRepository } from '#/contexts/inbox/infrastructure/repositories/inbox.repository'
import { createAtomicInboxCommandStore } from '#/contexts/inbox/infrastructure/inbox-command-store'
import { createReviewSourceLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/review-source-lookup.adapter'
import { createReplyLookupAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-lookup.adapter'
import { registerInboxConsumers } from '#/contexts/inbox/infrastructure/outbox-consumers'
import { registerInboxHandlers } from '#/contexts/inbox/infrastructure/event-handlers/index'
import { createInboxItem } from '#/contexts/inbox/application/use-cases/create-inbox-item'
import { rebuildInboxProjection } from '#/contexts/inbox/application/use-cases/rebuild-inbox-projection'
import { createInboxItem as buildInboxItem } from '#/contexts/inbox/domain/constructors'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '#/contexts/inbox/application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '#/contexts/inbox/application/ports/review-source-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'

// ── Constants (hex-only UUID fixtures) ──────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const EVENTS_QUEUE = `bqc39-events-${process.pid}`
const JOBS_QUEUE = `bqc39-jobs-${process.pid}`

const ORG = organizationId('4e000000-0000-4000-8000-0000000000a1')
const PROP = propertyId('4e000000-0000-4000-8000-0000000000b1')
const R1 = reviewId('4e000000-0000-4000-8000-0000000000c1') // created + updated
const R2 = reviewId('4e000000-0000-4000-8000-0000000000c2') // expired
const R3 = reviewId('4e000000-0000-4000-8000-0000000000c3') // reply.published
const R4 = reviewId('4e000000-0000-4000-8000-0000000000c4') // switch durable-primary
const REPLY3 = replyId('4e000000-0000-4000-8000-0000000000d3')
const BACKLOG = 12
const backlogReviewIds = Array.from({ length: BACKLOG }, (_, i) =>
  reviewId(`4e000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`),
)

const T1 = new Date('2026-07-01T12:00:00.000Z') // created (reviewedAt)
const T2 = new Date('2026-07-02T12:00:00.000Z') // updated (new reviewedAt)
const T3 = new Date('2026-07-03T12:00:00.000Z') // expired
const T4 = new Date('2026-07-04T12:00:00.000Z') // reply published
const T5 = new Date('2026-07-05T12:00:00.000Z') // rebuild clock / switch event

const CREATED_CONSUMER = 'inbox.on-review-created'
const UPDATED_CONSUMER = 'inbox.on-review-updated'
const EXPIRED_CONSUMER = 'inbox.on-review-expired'
const PUBLISHED_CONSUMER = 'inbox.on-reply-published'

// ── Shared fixtures ─────────────────────────────────────────────────

const db = getDb()
const outboxRepo = createOutboxRepository(db)
let pool: Pool
let redis: Redis | undefined
let redisAvailable = false
let eventsQueue: Queue | undefined
let jobsQueue: Queue | undefined
let worker: Worker | undefined
let relay: OutboxRelay | undefined
let policyHandle: { stopPolling: () => void } | undefined

/** Deterministic hex-only inbox item ids. */
let idCounter = 0
const idGen = (): InboxItemId =>
  inboxItemId(`4e000000-0000-4000-8000-0000000002${String(++idCounter).padStart(2, '0')}`)

/** The durable consumers' processing clock — fixed per phase (see header). */
let consumerNow = T1

const silentEvents: EventBus = { on: () => {}, emit: async () => {}, clear: () => {} }

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

/** Structured shadow.compare lines land here (content-free; asserted in (a)). */
const shadowLogLines: Array<Readonly<Record<string, unknown>>> = []
const shadowCollector = createShadowCompareCollector({
  logger: {
    info: (obj) => shadowLogLines.push(obj),
    warn: (obj) => shadowLogLines.push(obj),
  },
})

function makeReview(id: string, reviewedAt: Date, externalId: string): Review {
  return {
    id: reviewId(id),
    organizationId: ORG,
    propertyId: PROP,
    platform: 'google',
    externalId,
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Synthetic cutover review',
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
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
  }
}

function makeApprovedReply(): Reply {
  return {
    id: REPLY3,
    reviewId: R3,
    organizationId: ORG,
    text: 'Synthetic cutover reply',
    status: 'approved',
    source: 'internal',
    createdBy: null,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: new Date('2026-07-03T18:00:00.000Z'),
    approvedAt: new Date('2026-07-03T19:00:00.000Z'),
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: T3,
    updatedAt: T3,
  }
}

/** Real existence-check adapter (the durable consumer only reads .status). */
function makeReviewLookup(): ReviewLookupPort {
  const reviewRepo = createReviewRepository(db)
  return {
    getReviewSnippetById: async (id, orgId): Promise<ReviewSnippetResult> => {
      const row = await reviewRepo.findById(id, orgId)
      if (!row) return { status: 'not_found' }
      return {
        status: 'available',
        snippet: {
          reviewerName: row.reviewerName,
          text: null,
          reviewerProfilePhotoUrl: null,
          rating: row.rating,
        },
      }
    },
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [],
  }
}

/** Stub enrichment ports — the inbox repo owns the SQL, these answer lookups. */
const stubEnrichmentPorts = {
  reviewLookup: {
    getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
      status: 'not_found',
    }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [] as string[],
  },
  feedbackLookup: { getFeedbackSnippetById: async () => null },
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  },
}

function makeReviewSourceLookup(): ReviewSourceLookupPort {
  const reviewRepo = createReviewRepository(db)
  return createReviewSourceLookupAdapter({
    findById: (id, orgId) => reviewRepo.findById(id, orgId),
    findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
    findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
  })
}

function makeReplyLookup() {
  const replyRepo = createReplyRepository(db)
  return createReplyLookupAdapter({
    findInternalByReviewId: (id, orgId) => replyRepo.findInternalByReviewId(id, orgId),
    findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
  })
}

// ── Projection snapshot / restore (the shadow harness) ──────────────

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : null

/** Content-free read-back of one source's projection-owned row state. */
async function projectionSnapshot(sourceId: string): Promise<InboxProjectionSnapshot> {
  const r = await pool.query(
    `SELECT status, source_date, platform,
            first_reply_submitted_at, first_reply_published_at, closed_at
       FROM inbox_items WHERE organization_id = $1 AND source_id = $2`,
    [ORG, sourceId],
  )
  if (r.rows.length === 0) return { exists: false }
  const row = r.rows[0] as Record<string, unknown>
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

type SavedRows = Array<Record<string, unknown>>

async function snapshotProjectionRows(): Promise<SavedRows> {
  const r = await pool.query(
    'SELECT * FROM inbox_items WHERE organization_id = $1 ORDER BY id',
    [ORG],
  )
  return r.rows as SavedRows
}

/** Restore the exact pre-state so both paths process the event from parity. */
async function restoreProjectionRows(rows: SavedRows): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  if (rows.length === 0) return
  await pool.query(
    'INSERT INTO inbox_items SELECT * FROM json_populate_recordset(null::inbox_items, $1::json)',
    [JSON.stringify(rows)],
  )
}

// ── Runtime helpers ─────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Bounded wait for the worker to record receipts (no fixed sleeps). */
async function waitForReceipts(
  eventIds: ReadonlyArray<string>,
  consumer: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now()
  for (;;) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM event_consumer_receipts
        WHERE consumer_name = $1 AND event_id = ANY($2)`,
      [consumer, [...eventIds]],
    )
    const n = (r.rows[0] as { n: number }).n
    if (n >= eventIds.length) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${eventIds.length} receipt(s) from ${consumer} (got ${n})`,
      )
    }
    await sleep(50)
  }
}

async function receiptsFor(eventId: string): Promise<Array<Record<string, unknown>>> {
  const r = await pool.query(
    'SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1',
    [eventId],
  )
  return r.rows as Array<Record<string, unknown>>
}

/** Redeliver a recorded event through the REAL dispatcher handler. */
async function redeliver(eventId: string, eventType: string): Promise<void> {
  const r = await pool.query('SELECT * FROM outbox_events WHERE id = $1', [eventId])
  const row = r.rows[0] as Record<string, unknown>
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
  const handler = createDispatcherHandler(outboxRepo)
  await handler({ id: eventId, name: eventType, data: envelope } as unknown as Job)
}

async function itemsFor(sourceId: string): Promise<Array<Record<string, unknown>>> {
  const r = await pool.query(
    `SELECT id, status, source_date, closed_at,
            first_reply_submitted_at, first_reply_published_at
       FROM inbox_items WHERE organization_id = $1 AND source_id = $2`,
    [ORG, sourceId],
  )
  return r.rows as Array<Record<string, unknown>>
}

/**
 * Created facts for one review source. The fact's source_aggregate_id is the
 * inboxItemId (aggregate extraction prefers it), so the review linkage is
 * read from the identifier-only payload's sourceId.
 */
async function createdFactsFor(
  sourceId: string,
): Promise<Array<Record<string, unknown>>> {
  const r = await pool.query(
    `SELECT id FROM outbox_events
      WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'
        AND payload->>'sourceId' = $2`,
    [ORG, sourceId],
  )
  return r.rows as Array<Record<string, unknown>>
}

/** Seed an open inbox item for a review without emitting any fact. */
async function seedOpenItem(source: string, sourceDate: Date): Promise<void> {
  const store = createAtomicInboxCommandStore(db, silentEvents)
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
  await store.createItem(built.value, null)
}

// ── Suite ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()

  clearEventSchemas()
  registerAllEventSchemas()

  // Defensive cleanup: a crashed prior run must not pollute counts (the
  // afterAll cleanup is org-scoped identically).
  await pool.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM policy_decision_audit WHERE organization_id = $1', [ORG])

  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 2000 })
  try {
    await redis.ping()
    redisAvailable = true
  } catch {
    redisAvailable = false
    return
  }
  const connection = redis as unknown as import('bullmq').ConnectionOptions
  eventsQueue = new Queue(EVENTS_QUEUE, { connection })
  jobsQueue = new Queue(JOBS_QUEUE, { connection })
  try {
    await eventsQueue.obliterate({ force: true })
    await jobsQueue.obliterate({ force: true })
  } catch {
    // best-effort — the queues may not exist yet
  }

  // Delayed-execution policy for the dispatcher's BQC-3.2 consumer gate.
  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  policyHandle = initPersistedCapabilityPolicyStore({
    db,
    env: {} as CapabilityPolicyEnv,
  })

  // Durable consumers (module-global registry — clear first for isolation).
  clearConsumers()
  registerInboxConsumers({
    commandStore: createAtomicInboxCommandStore(db, silentEvents),
    reviewLookup: makeReviewLookup(),
    reviewSourceLookup: makeReviewSourceLookup(),
    inboxRepo: createInboxRepository(db, stubEnrichmentPorts),
    idGen,
    clock: () => consumerNow,
  })

  // The REAL dispatcher on a REAL BullMQ worker (the worker/index.ts wiring).
  worker = new Worker(EVENTS_QUEUE, createDispatcherHandler(outboxRepo), {
    connection,
    concurrency: 4,
  })
  await worker.waitUntilReady()
  relay = createOutboxRelay(outboxRepo, eventsQueue)

  // Org + property fixtures.
  await pool.query(`DELETE FROM organization WHERE slug = 'bqc39-cutover' AND id <> $1`, [
    ORG,
  ])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'BQC39 Cutover Org', 'bqc39-cutover', NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'BQC39 Property', 'bqc39-prop', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP, ORG],
  )
})

afterAll(async () => {
  await worker?.close()
  try {
    await eventsQueue?.obliterate({ force: true })
    await jobsQueue?.obliterate({ force: true })
  } catch {
    // best-effort
  }
  await eventsQueue?.close()
  await jobsQueue?.close()
  redis?.disconnect()
  policyHandle?.stopPolling()
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  clearConsumers()
  if (pool) {
    await pool.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
    // Receipts cascade from outbox_events.
    await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
    await pool.query('DELETE FROM policy_decision_audit WHERE organization_id = $1', [
      ORG,
    ])
    await pool.query('DELETE FROM properties WHERE id = $1', [PROP])
    await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
    await pool.end()
  }
  clearEventSchemas()
})

describe.sequential('durable cutover synthetic proof (BQC-3.9)', () => {
  it('(a) durable path projects exactly what the bus path projects + no double effects', async () => {
    if (!redisAvailable || !relay || !jobsQueue) return
    const relayNow = relay

    // The bus path: REAL inbox bus handlers on a dedicated bus, wired through
    // the REAL use case + repositories (record-only registration posture).
    const busBus = createEventBus()
    const busRepo = createInboxRepository(db, stubEnrichmentPorts)
    const busCreateInboxItem = createInboxItem({
      repo: busRepo,
      commandStore: createAtomicInboxCommandStore(db, busBus),
      idGen,
      clock: () => T1,
    })
    registerInboxHandlers({
      events: busBus,
      createInboxItem: busCreateInboxItem,
      repo: busRepo,
    })

    /**
     * Shadow run: snapshot pre-state → bus path → snapshot → restore pre-state
     * → durable path (fixed clock = event time) → snapshot → compare. Both
     * paths process the SAME event from projection parity.
     */
    async function shadowRun(args: {
      family: CutoverFamily
      consumerName: string
      sourceId: string
      eventId: string
      occurredAt: Date
      busEmit: () => Promise<void>
    }): Promise<void> {
      const preState = await snapshotProjectionRows()
      await args.busEmit()
      const busOutcome = await projectionSnapshot(args.sourceId)
      await restoreProjectionRows(preState)
      consumerNow = args.occurredAt
      await relayNow.poll()
      await waitForReceipts([args.eventId], args.consumerName)
      const durableOutcome = await projectionSnapshot(args.sourceId)
      shadowCollector.record(
        compareInboxProjection({
          family: args.family,
          eventId: args.eventId,
          bus: busOutcome,
          durable: durableOutcome,
        }),
      )
    }

    // ── review.created (bus + durable both project) ──────────────────
    const reviewStore = createAtomicReviewCommandStore(db, silentEvents)
    const e1 = reviewCreated({
      reviewId: R1,
      propertyId: PROP,
      organizationId: ORG,
      platform: 'google',
      externalId: 'bqc39-r1',
      occurredAt: T1,
    })
    await reviewStore.upsertAndRecord(makeReview(R1, T1, 'bqc39-r1'), e1, T1)
    await shadowRun({
      family: 'review.created',
      consumerName: CREATED_CONSUMER,
      sourceId: R1,
      eventId: e1.eventId,
      occurredAt: T1,
      busEmit: () => busBus.emit(e1),
    })
    expect((await projectionSnapshot(R1)).status).toBe('open')

    // ── review.updated (durable-only projector — BQC-1.2 removed the bus
    //    handler; the durable metadata refresh is asserted directly) ────
    const e2 = reviewUpdated({
      reviewId: R1,
      propertyId: PROP,
      organizationId: ORG,
      platform: 'google',
      externalId: 'bqc39-r1',
      occurredAt: T2,
    })
    await reviewStore.upsertAndRecord(makeReview(R1, T2, 'bqc39-r1'), e2, T2)
    await busBus.emit(e2) // no bus handler by design — projection untouched
    const busOutcomeUpdated = await projectionSnapshot(R1)
    await relayNow.poll()
    await waitForReceipts([e2.eventId], UPDATED_CONSUMER)
    const durableOutcomeUpdated = await projectionSnapshot(R1)
    expect(busOutcomeUpdated.sourceDate).toBe(T1.toISOString()) // bus inert
    expect(durableOutcomeUpdated.sourceDate).toBe(T2.toISOString()) // refreshed

    // ── review.expired ────────────────────────────────────────────────
    const reviewRepo = createReviewRepository(db)
    await reviewRepo.upsert(makeReview(R2, T1, 'bqc39-r2'))
    await seedOpenItem(R2, T1)
    const replyStore = createAtomicReplyCommandStore(db, silentEvents)
    const e3 = reviewExpired({
      reviewId: R2,
      propertyId: PROP,
      organizationId: ORG,
      occurredAt: T3,
    })
    await replyStore.purgeExpiredReview(R2, e3)
    await shadowRun({
      family: 'review.expired',
      consumerName: EXPIRED_CONSUMER,
      sourceId: R2,
      eventId: e3.eventId,
      occurredAt: T3,
      busEmit: () => busBus.emit(e3),
    })

    // ── review.reply.published ────────────────────────────────────────
    await reviewRepo.upsert(makeReview(R3, T1, 'bqc39-r3'))
    await seedOpenItem(R3, T1)
    const replyRepo = createReplyRepository(db)
    const seededReply = await replyRepo.upsert(makeApprovedReply())
    const e4 = reviewReplyPublished({
      replyId: REPLY3,
      reviewId: R3,
      propertyId: PROP,
      organizationId: ORG,
      userId: null,
      authorId: null,
      occurredAt: T4,
    })
    const published = await replyStore.markPublished(
      seededReply,
      { status: 'published', publishedAt: T4 },
      e4,
      T4,
    )
    expect(published).not.toBeNull()
    await shadowRun({
      family: 'review.reply.published',
      consumerName: PUBLISHED_CONSUMER,
      sourceId: R3,
      eventId: e4.eventId,
      occurredAt: T4,
      busEmit: () => busBus.emit(e4),
    })

    // ── Shadow summary: every compared family matches ─────────────────
    const summary = shadowCollector.summary()
    expect(summary).toMatchObject({ compared: 3, matched: 3, mismatched: 0 })
    expect(shadowLogLines).toHaveLength(3)
    for (const line of shadowLogLines) {
      expect(line.outcome).toBe('match')
      expect(line.mismatchFields).toEqual([])
      // Content-free: only family/eventId/outcome/field-names are logged.
      expect(Object.keys(line).sort()).toEqual([
        'eventId',
        'family',
        'mismatchFields',
        'outcome',
      ])
    }

    // ── Receipts: exactly one per consumer per event ──────────────────
    expect(await receiptsFor(e1.eventId)).toEqual([
      { consumer_name: CREATED_CONSUMER, status: 'applied' },
    ])
    expect(await receiptsFor(e2.eventId)).toEqual([
      { consumer_name: UPDATED_CONSUMER, status: 'applied' },
    ])
    expect(await receiptsFor(e3.eventId)).toEqual([
      { consumer_name: EXPIRED_CONSUMER, status: 'applied' },
    ])
    expect(await receiptsFor(e4.eventId)).toEqual([
      { consumer_name: PUBLISHED_CONSUMER, status: 'applied' },
    ])

    // ── Dual delivery cannot double effects: re-emit on the bus AND
    //    redeliver through the dispatcher — receipt fencing + the
    //    already-exists guard hold; exactly one item, one receipt. ─────
    await busBus.emit(e1)
    await redeliver(e1.eventId, 'review.created')
    expect(await itemsFor(R1)).toHaveLength(1)
    expect(await receiptsFor(e1.eventId)).toHaveLength(1)
    // The two harness runs (bus then durable, with a projection reset between
    // them) legitimately produced one created fact EACH — that is the harness
    // artifact of resetting the projection. Production dual delivery (no
    // reset) yields ONE fact because the second applier sees the existing row;
    // the re-emits above added none.
    expect(await createdFactsFor(R1)).toHaveLength(2)

    // ── External-effect dedup mechanism: the review-sync enqueue shape
    //    dedups by BullMQ jobId (what covers dual delivery for the only
    //    external-effect consumer family). ─────────────────────────────
    const syncData = {
      propertyId: PROP as string,
      organizationId: ORG as string,
      connectionId: '4e000000-0000-4000-8000-0000000000ee',
      locationName: 'accounts/111/locations/222',
    }
    const syncOpts = {
      jobId: 'bqc39-sync-dedup',
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      ...jobEnqueueOptions('sync-property-reviews'),
    }
    await jobsQueue.add('sync-property-reviews', syncData, syncOpts)
    await jobsQueue.add('sync-property-reviews', syncData, syncOpts)
    const syncJobs = await jobsQueue.getJobs(['waiting', 'delayed', 'active'])
    expect(syncJobs).toHaveLength(1)
    expect(syncJobs[0]!.name).toBe('sync-property-reviews')
  }, 60_000)

  it('(b) drains the pre-dispatcher backlog exactly once', async () => {
    if (!redisAvailable || !relay) return

    // N facts committed by the REAL atomic producer BEFORE any relay poll —
    // the pre-dispatcher backlog (bus silent: no projection happened).
    const reviewStore = createAtomicReviewCommandStore(db, silentEvents)
    const backlogEventIds: string[] = []
    for (let i = 0; i < BACKLOG; i++) {
      const rid = backlogReviewIds[i]!
      const event = reviewCreated({
        reviewId: rid,
        propertyId: PROP,
        organizationId: ORG,
        platform: 'google',
        externalId: `bqc39-backlog-${i}`,
        occurredAt: T1,
      })
      await reviewStore.upsertAndRecord(
        makeReview(rid, T1, `bqc39-backlog-${i}`),
        event,
        T1,
      )
      backlogEventIds.push(event.eventId)
    }

    // Nothing processed yet — the dispatcher has never seen these rows.
    for (const eventId of backlogEventIds) {
      expect(await receiptsFor(eventId)).toHaveLength(0)
    }

    await relay.poll()
    await waitForReceipts(backlogEventIds, CREATED_CONSUMER)

    // Every backlog event: exactly one 'applied' receipt, exactly one item.
    for (let i = 0; i < BACKLOG; i++) {
      expect(await receiptsFor(backlogEventIds[i]!)).toEqual([
        { consumer_name: CREATED_CONSUMER, status: 'applied' },
      ])
      expect(await itemsFor(backlogReviewIds[i]!)).toHaveLength(1)
    }

    // Redelivery still cannot reprocess — receipts fence exactly-once.
    await redeliver(backlogEventIds[0]!, 'review.created')
    expect(await receiptsFor(backlogEventIds[0]!)).toHaveLength(1)
    expect(await itemsFor(backlogReviewIds[0]!)).toHaveLength(1)
  }, 60_000)

  it('(c) repairs a corrupted projection (dry-run reports first)', async () => {
    if (!redisAvailable) return

    // Post-(a)/(b) state: R1 open (sourceDate T2), R2 closed, R3 closed with
    // the published milestone, 12 open backlog items.
    const rebuild = rebuildInboxProjection({
      repo: createInboxRepository(db, stubEnrichmentPorts),
      commandStore: createAtomicInboxCommandStore(db, silentEvents),
      reviewSourceLookup: makeReviewSourceLookup(),
      replyLookup: makeReplyLookup(),
      idGen,
      clock: () => T5,
      logger: noopLogger,
    })

    // Corrupt: reopen the expired item, reopen + de-stamp the published item,
    // delete the live item outright.
    await pool.query(
      `UPDATE inbox_items SET status = 'open', closed_at = NULL
        WHERE organization_id = $1 AND source_id = $2`,
      [ORG, R2],
    )
    await pool.query(
      `UPDATE inbox_items SET status = 'open', closed_at = NULL,
              first_reply_submitted_at = NULL, first_reply_published_at = NULL
        WHERE organization_id = $1 AND source_id = $2`,
      [ORG, R3],
    )
    await pool.query(
      'DELETE FROM inbox_items WHERE organization_id = $1 AND source_id = $2',
      [ORG, R1],
    )

    // Dry-run: full report, zero writes — the corruption persists.
    const dry = await rebuild({ organizationId: ORG, dryRun: true })
    expect(dry).toMatchObject({ created: 1, closed: 2, milestones: 1, dryRun: true })
    expect((await projectionSnapshot(R2)).status).toBe('open')
    expect(await itemsFor(R1)).toHaveLength(0)

    // Real run: heals exactly what the dry-run reported.
    const report = await rebuild({ organizationId: ORG, dryRun: false })
    expect(report).toMatchObject({ created: 1, closed: 2, milestones: 1, dryRun: false })
    // scanned = 14 existing items (12 backlog + R2 + R3) + 14 canonical
    // sources (12 backlog + R1 + R3 — R2's review is purged).
    expect(report.scanned).toBe(28)

    const r1 = await projectionSnapshot(R1)
    expect(r1).toMatchObject({
      exists: true,
      status: 'open',
      sourceDate: T2.toISOString(),
    })
    const r2 = await projectionSnapshot(R2)
    expect(r2).toMatchObject({ exists: true, status: 'closed' })
    const r3 = await projectionSnapshot(R3)
    expect(r3).toMatchObject({
      exists: true,
      status: 'closed',
      firstReplySubmittedAt: '2026-07-03T18:00:00.000Z',
      firstReplyPublishedAt: T4.toISOString(),
    })
    // Repair does not re-emit the created fact (rebuild is repair, not new
    // information): still exactly the two harness-artifact facts from (a).
    expect(await createdFactsFor(R1)).toHaveLength(2)
  }, 60_000)

  it('(d) switch mode: bus handlers retired, the durable path alone projects', async () => {
    if (!redisAvailable || !relay) return

    // Registration assertion: with review.created in 'switch', the family's
    // bus handlers are NOT registered (legacy path retired for the family).
    const registrations: string[] = []
    const recordingBus: EventBus = {
      on: (tag) => {
        registrations.push(tag)
      },
      emit: async () => {},
      clear: () => {},
    }
    registerInboxHandlers({
      events: recordingBus,
      createInboxItem: createInboxItem({
        repo: createInboxRepository(db, stubEnrichmentPorts),
        commandStore: createAtomicInboxCommandStore(db, silentEvents),
        idGen,
        clock: () => T5,
      }),
      repo: createInboxRepository(db, stubEnrichmentPorts),
      cutoverState: (family) => (family === 'review.created' ? 'switch' : 'record-only'),
    })
    expect(registrations).toEqual([
      'guest.feedback.submitted',
      'review.reply.published',
      'review.reply.submitted',
      'review.expired',
    ])

    // Durable-primary: the fact is produced on a bus with NO inbox handlers —
    // only the durable path can project it.
    const reviewStore = createAtomicReviewCommandStore(db, silentEvents)
    const e5 = reviewCreated({
      reviewId: R4,
      propertyId: PROP,
      organizationId: ORG,
      platform: 'google',
      externalId: 'bqc39-r4',
      occurredAt: T5,
    })
    await reviewStore.upsertAndRecord(makeReview(R4, T5, 'bqc39-r4'), e5, T5)

    await relay.poll()
    await waitForReceipts([e5.eventId], CREATED_CONSUMER)

    expect(await receiptsFor(e5.eventId)).toEqual([
      { consumer_name: CREATED_CONSUMER, status: 'applied' },
    ])
    expect(await projectionSnapshot(R4)).toEqual({
      exists: true,
      status: 'open',
      sourceDate: T5.toISOString(),
      platform: 'google',
      firstReplySubmittedAt: null,
      firstReplyPublishedAt: null,
      closedAt: null,
    })
    // Exactly one created fact — the durable applyOnce; the retired bus path
    // provably contributed nothing.
    expect(await createdFactsFor(R4)).toHaveLength(1)
  }, 60_000)
})
