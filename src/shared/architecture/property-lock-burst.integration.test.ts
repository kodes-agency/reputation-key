// Burst regression for the Property source fence (closed beta, 2026-09-29).
//
// A Google import inserted 244 reviews into one Property in 30 s. Each import
// transaction and each Inbox projection took the Property fence, the Inbox
// projection held it while it waited for a second pool client, and metric
// readings queued behind it on their foreign-key check. The worker's 10-client
// pool ran dry and consumers failed at the lock timeout
// (`select "source_epoch" from "properties" ... for update`,
// `metric.commandStore.recordMetrics failed after ~10000ms`).
//
// This replays that shape against real Postgres with the real stores: one
// import stream upserting reviews while the domain-event dispatcher runs both
// `review.created` consumers (Inbox projection and the metric reading) for
// every imported review, all on one Property, over a pool the dispatcher alone
// can exhaust. No operation may reach the lock timeout.

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import {
  inboxItemId,
  metricReadingId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { JOB_OPERATIONAL_QUEUE_CONCURRENCY } from '#/shared/jobs/operational-catalogue'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { reviewCreated } from '#/contexts/review/domain/events'
import type { Review, StarRating } from '#/contexts/review/domain/types'
import { createAtomicReviewCommandStore } from '#/contexts/review/infrastructure/review-command-store'
import { createReviewResponseTargetAuthority } from '#/contexts/review/infrastructure/response-target-authority'
import { createReviewResponseTargetAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/review-response-target-authority.adapter'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/inbox/infrastructure/inbox-command-store'
import {
  handleInboxReviewCreated,
  type InboxConsumerDeps,
} from '#/contexts/inbox/infrastructure/outbox-consumers'
import { createInboxRepository } from '#/contexts/inbox/infrastructure/repositories/inbox.repository'
import { createReviewHandlingCycleStore } from '#/contexts/inbox/infrastructure/review-handling-cycle.store'
import type { FeedbackLookupPort } from '#/contexts/inbox/application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '#/contexts/inbox/application/ports/property-lookup.port'
import type { ReviewLookupPort } from '#/contexts/inbox/application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '#/contexts/inbox/application/ports/review-source-lookup.port'
import { recordMetric } from '#/contexts/reporting/application/use-cases/record-metric'
import { createAtomicMetricCommandStore } from '#/contexts/reporting/infrastructure/metric-command-store'
import { registerPublicReputationMetricConsumers } from '#/contexts/reporting/infrastructure/public-reputation-outbox-consumers'
import { createMetricRegistryRepository } from '#/contexts/reporting/infrastructure/repositories/metric-registry.repository'
import { createPropertyLocalDateResolver } from '#/contexts/reporting/infrastructure/repositories/property-local-date'

const ORG = organizationId('org-property-lock-burst')
const PROPERTY = propertyId('af300000-0000-4000-8000-000000000001')
const APPLICATION_NAME = 'rk-property-lock-burst'
const IMPORTED_AT = new Date('2026-09-29T17:37:00.000Z')
/** Reviews in the burst: enough for the dispatcher to saturate the pool. */
const BURST_REVIEWS = 40
/** The worker pool on the beta; the dispatcher's slots alone can exhaust it. */
const EXHAUSTIBLE_POOL_SIZE = 10
const DISPATCH_CONCURRENCY = JOB_OPERATIONAL_QUEUE_CONCURRENCY['domain-events']
/** Production relays every second; the import here runs ~10x faster. */
const RELAY_TICK_MS = 100
/**
 * Production uses 10 s. Any lock wait that long is the failure this guards,
 * so a shorter bound keeps a regression fast without flaking a healthy run.
 */
const LOCK_TIMEOUT_MS = 3_000
const CONNECTION_TIMEOUT_MS = 15_000
const BURST_TEST_TIMEOUT_MS = 180_000

type OperationKind = 'import' | 'inbox' | 'metric'
type Outcome = Readonly<{ kind: OperationKind; ms: number; failure: string | null }>

let lease: TestLease
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const reviewLookup = {
  getReviewSnippetById: async () => ({ status: 'not_found' as const }),
  getReviewSnippetsByIds: async () => new Map(),
  findEligibleReviewIds: async () => [],
} satisfies ReviewLookupPort

const reviewSourceLookup = {
  getReviewSourceMetaById: async () => null,
  getReviewSourceMetaByIds: async () => [],
  listReviewSources: async () => [],
} satisfies ReviewSourceLookupPort

const feedbackLookup = {
  getFeedbackSnippetById: async () => null,
  getFeedbackSnippetsByIds: async () => new Map(),
  findEligibleFeedbackIds: async () => [],
} satisfies FeedbackLookupPort

const propertyLookup = {
  getPropertyNameById: async () => null,
  getPropertyNamesByIds: async () => new Map(),
} satisfies PropertyLookupPort

/** SQLSTATE of a pg error, directly or behind Drizzle's query wrapper. */
function failureCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause
  const code = (error as { code?: unknown }).code ?? cause?.code
  if (typeof code === 'string') return code
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message.slice(0, 80) : 'unknown'
}

async function measure(
  kind: OperationKind,
  outcomes: Outcome[],
  operation: () => Promise<unknown>,
): Promise<boolean> {
  const started = performance.now()
  try {
    await operation()
    outcomes.push({ kind, ms: performance.now() - started, failure: null })
    return true
  } catch (error) {
    outcomes.push({ kind, ms: performance.now() - started, failure: failureCode(error) })
    return false
  }
}

function burstReview(index: number): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: reviewId(randomUUID()),
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: `property-lock-burst-${index}`,
    externalLocationId: 'locations/property-lock-burst',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    rating: ((index % 5) + 1) as StarRating,
    text: `Burst review ${index}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date(IMPORTED_AT.getTime() - (index + 1) * 60_000),
    expiresAt: new Date('2027-09-29T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date(IMPORTED_AT.getTime() - (index + 1) * 60_000),
    sourceUpdatedAt: null,
    firstFetchedAt: IMPORTED_AT,
    lastFetchedAt: IMPORTED_AT,
    contentExpiresAt: new Date('2026-10-29T12:00:00.000Z'),
    contentHash: `property-lock-burst-${index}`,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 16,
    aiSourceDigest: index.toString(16).padStart(64, 'd'),
  }
}

/** The `review.created` fact the import committed, as the relay delivers it. */
async function createdEvent(review: string): Promise<ConsumerEvent> {
  const result = await lease.pool.query<{
    id: string
    event_type: string
    event_version: number
    payload: unknown
    organization_id: string
    property_id: string | null
    source_context: string
    source_aggregate_id: string
    created_at: Date
  }>(
    `SELECT id, event_type, event_version, payload, organization_id, property_id,
            source_context, source_aggregate_id, created_at
     FROM outbox_events
     WHERE organization_id = $1 AND event_type = 'review.created'
       AND source_aggregate_id = $2`,
    [ORG, review],
  )
  const row = result.rows[0]
  if (!row) throw new Error('import committed no review.created fact')
  return buildConsumerEvent({
    id: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    sourceContext: row.source_context,
    sourceAggregateId: row.source_aggregate_id,
    recordedAt: row.created_at,
  })
}

/** The production `metric.public-reputation` handler, wired to `db`. */
function publicReputationHandler(
  db: ReturnType<typeof drizzle>,
): (event: ConsumerEvent) => Promise<unknown> {
  let handler: ((event: ConsumerEvent) => Promise<unknown>) | undefined
  const registry = {
    registerConsumer: (registration) => {
      handler = registration.handler
    },
  } as Pick<ConsumerRegistry, 'registerConsumer'> as ConsumerRegistry
  registerPublicReputationMetricConsumers(registry, {
    recordMetric: recordMetric({
      commandStore: createAtomicMetricCommandStore(db, () => randomUUID()),
      registry: createMetricRegistryRepository(),
      clock: () => IMPORTED_AT,
      idGen: () => metricReadingId(randomUUID()),
      resolvePropertyLocalDate: createPropertyLocalDateResolver(db),
    }),
    reviewRatingLookup: { getEligibleRatingById: async () => 4 },
    db,
  })
  if (!handler) throw new Error('metric.public-reputation did not register')
  return handler
}

function inboxDeps(db: ReturnType<typeof drizzle>): InboxConsumerDeps {
  return {
    commandStore: createAtomicInboxCommandStore(
      db,
      allowAllCommandAuthority,
      () => IMPORTED_AT,
    ),
    handlingCycleStore: createReviewHandlingCycleStore(db),
    replyObservationAuthority: { withExactCurrent: async () => ({ status: 'obsolete' }) },
    responseTargetAuthority: createReviewResponseTargetAuthorityAdapter(
      createReviewResponseTargetAuthority(db),
    ),
    sourceTransitionAuthority: { withExactCurrent: async () => ({ status: 'obsolete' }) },
    reviewLookup,
    reviewSourceLookup,
    inboxRepo: createInboxRepository(
      db,
      { reviewLookup, feedbackLookup, propertyLookup },
      { clock: () => IMPORTED_AT, logger: createMockLogger() },
    ),
    idGen: () => inboxItemId(randomUUID()),
    clock: () => IMPORTED_AT,
    logger: createMockLogger(),
  }
}

/** A fixed number of dispatch slots draining a FIFO of deliveries. */
function createDispatcher(slots: number) {
  const pending: Array<() => Promise<void>> = []
  const idle: Array<() => void> = []
  let closed = false
  const workers = Array.from({ length: slots }, async () => {
    for (;;) {
      const delivery = pending.shift()
      if (delivery) {
        await delivery()
        continue
      }
      if (closed) return
      await new Promise<void>((resolve) => idle.push(resolve))
    }
  })
  return {
    dispatch(delivery: () => Promise<void>): void {
      pending.push(delivery)
      idle.shift()?.()
    },
    async drain(): Promise<void> {
      closed = true
      for (const wake of idle.splice(0)) wake()
      await Promise.all(workers)
    },
  }
}

async function runBurst(): Promise<Outcome[]> {
  const db = drizzle(pool)
  const importer = createAtomicReviewCommandStore(db, () => IMPORTED_AT)
  const inbox = inboxDeps(db)
  const metric = publicReputationHandler(db)
  const dispatcher = createDispatcher(DISPATCH_CONCURRENCY)
  const outcomes: Outcome[] = []
  // The relay publishes whatever committed since its last tick in one batch,
  // so the dispatcher sees bursts while the import is still running.
  let committed: ConsumerEvent[] = []
  const publish = (): void => {
    for (const event of committed) {
      dispatcher.dispatch(async () => {
        await measure('inbox', outcomes, () => handleInboxReviewCreated(inbox, event))
      })
      dispatcher.dispatch(async () => {
        await measure('metric', outcomes, () => metric(event))
      })
    }
    committed = []
  }
  const relay = setInterval(publish, RELAY_TICK_MS)

  try {
    for (let index = 0; index < BURST_REVIEWS; index += 1) {
      const review = burstReview(index)
      const imported = await measure('import', outcomes, () =>
        importer.upsertAndRecord(
          review,
          (persisted) =>
            reviewCreated({
              reviewId: persisted.id,
              propertyId: persisted.propertyId,
              organizationId: persisted.organizationId,
              platform: persisted.platform,
              sourceEpoch: persisted.sourceEpoch,
              sourceRevision: persisted.sourceRevision,
              analysisSequence: persisted.analysisSequence,
              occurredAt: IMPORTED_AT,
            }),
          IMPORTED_AT,
          index.toString(16).padStart(64, 'e'),
          'historical_onboarding',
        ),
      )
      if (!imported) continue
      // Read before pushing: a relay tick during the read swaps the batch.
      const event = await createdEvent(review.id)
      committed.push(event)
    }
  } finally {
    clearInterval(relay)
    publish()
  }
  await dispatcher.drain()
  return outcomes
}

function summarize(outcomes: readonly Outcome[]) {
  const byKind = (kind: OperationKind) => {
    const durations = outcomes
      .filter((outcome) => outcome.kind === kind)
      .map((outcome) => outcome.ms)
      .sort((left, right) => left - right)
    const at = (quantile: number) =>
      Math.round(
        durations[
          Math.min(durations.length - 1, Math.floor(quantile * durations.length))
        ] ?? 0,
      )
    return {
      count: durations.length,
      failed: outcomes.filter((outcome) => outcome.kind === kind && outcome.failure)
        .length,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      maxMs: Math.round(durations.at(-1) ?? 0),
    }
  }
  return { import: byKind('import'), inbox: byKind('inbox'), metric: byKind('metric') }
}

async function clean(): Promise<void> {
  for (const table of [
    'metric_readings',
    'inbox_items',
    'outbox_events',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_heads',
    'reviews',
    'properties',
  ]) {
    await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: EXHAUSTIBLE_POOL_SIZE,
    application_name: APPLICATION_NAME,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    onConnect: (client) => client.query(`SET lock_timeout = ${LOCK_TIMEOUT_MS}`),
  })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await pool.end()
  await clean()
  await deleteTestOrganizations(lease.pool, [ORG])
  await lease.release()
  clearEventSchemas()
})

beforeEach(async () => {
  await clean()
  await seedOrgs(lease.pool, [ORG])
  await lease.pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Property lock burst', 'property-lock-burst', 'UTC')`,
    [PROPERTY, ORG],
  )
})

describe('review import burst on one Property', () => {
  it(
    'projects and measures every imported review without a lock timeout',
    async ({ task }) => {
      const started = performance.now()
      const outcomes = await runBurst()
      const summary = {
        wallMs: Math.round(performance.now() - started),
        ...summarize(outcomes),
      }
      // Read back with `--reporter=json`: the before/after evidence for the fix.
      Object.assign(task.meta, { propertyLockBurst: summary })

      const failures = outcomes
        .filter((outcome) => outcome.failure !== null)
        .map(({ kind, failure }) => `${kind}: ${failure}`)
      expect(failures).toEqual([])
      const projected = await lease.pool.query<{ items: number; readings: number }>(
        `SELECT (SELECT count(*)::int FROM inbox_items WHERE organization_id = $1) AS items,
                (SELECT count(*)::int FROM metric_readings WHERE organization_id = $1) AS readings`,
        [ORG],
      )
      expect(projected.rows[0]).toEqual({ items: BURST_REVIEWS, readings: BURST_REVIEWS })
    },
    BURST_TEST_TIMEOUT_MS,
  )
})
