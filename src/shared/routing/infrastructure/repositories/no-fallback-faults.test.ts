// BQC-4.6 — no-fallback fault proof (real PostgreSQL + real Redis/BullMQ).
//
// fallow-ignore-file boundary-violation
// This cross-context end-to-end proof BY DESIGN wires the real property
// routing adapter, review command stores, outbox relay, gated dispatch and
// BullMQ workers the same way the worker composition does
// (src/worker/index.ts); no single context's zone can own it, and the
// integration project discovers it via the infrastructure/repositories glob.
//
// Phase doc §4.6: inject unavailable queue / database / provider conditions in
// the US target cell and prove jobs remain in the approved cell, age/alert
// visibly, and resume/reconcile there — plus the denied-Europe routing repeat.
// At NO point may a failure invoke a fallback adapter, queue, endpoint, or
// region. Enforcement references: the BQC-4.3 architecture guards
// (src/shared/architecture/provider-target-selection.test.ts,
// adr-0048-presence.test.ts) and the BQC-4.2 wrong-cell/blocked quarantine in
// src/shared/jobs/delayed-execution-gate.ts.
//
// Conditions (one describe each):
//   (a) QUEUE UNAVAILABLE AT PUBLISH — the relay's BullMQ add fails against a
//       dead-port connection; the claimed event is NOT marked published; its
//       lease expires; a healthy handle of the SAME queue re-claims and
//       publishes it (resume in-cell; no second queue/region is touched).
//   (b) DATABASE UNAVAILABLE AT DISPATCH — the routing adapter's DB read
//       throws inside the 4.2 routing gate: the dispatch THROWS (transient
//       infra semantics — NOT a quarantinable policy rejection), BullMQ
//       retries, and at attempts-exhaustion the 3.6 worker 'failed' path
//       parks the job in the dead-letter quarantine.
//   (c) PROVIDER (GBP) DOWN — publish-reply against a failing googleReviewApi:
//       5xx classifies retryable → markPublicationRetryQueued + rethrow
//       (BullMQ attempts); an ambiguous final attempt (provider timeout)
//       persists publish_failed + publication_state='ambiguous' +
//       reconcile_due_at (3.3/3.8 states); the 3.6 quarantine envelope holds
//       the job with policyReason ABSENT (not a policy failure) and
//       identifier-only data. Only the cell's single provider binding is ever
//       called — no alternate provider exists (4.3).
//   (d) AGING/VISIBILITY — the 3.7 health metrics read the real parked state:
//       oldestUnpublishedAgeMs > 0 for the unpublished event; quarantine
//       count/age reflect the quarantined job; failedReason is content-safe.
//   (e) RESUME/RECONCILE IN-CELL — a sync job quarantined during the DB
//       outage redrives via createRedriveJob back onto its ORIGINAL queue
//       with a fresh attempt budget + redriveMetadata; with healthy
//       dependencies the dispatch succeeds and the handler runs EXACTLY ONCE
//       across the whole saga.
//   (f) DENIED EUROPE PROPERTY (the §4.6 repeat) — a property with
//       processing_region='europe' dispatches a sync job; the 4.2 gate
//       quarantines it with policyReason 'routing_blocked:region_denied' and
//       the handler NEVER runs; a redrive (as after a region approval)
//       re-queues it, but with the region unchanged the SECOND dispatch
//       blocks again — no silent override.
//
// Determinism: relay polls and dispatch closures are invoked directly (never
// interval-driven); lease expiry is simulated by backdating lease_expires_at
// (never a wall-clock sleep); BullMQ worker completion is awaited via bounded
// condition polling (vi.waitFor); queue names are unique to this suite and
// obliterated up front; unavailability uses a dead-port connection — the
// shared Redis is never killed or restarted. Skips cleanly when Redis is
// unreachable (same convention as the BQC-3.6 quarantine suite).

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import { createServer } from 'node:net'
import { Queue, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createOutboxRelay } from '#/shared/outbox/relay'
import {
  createGatedJobHandler,
  type JobRoutingGate,
} from '#/shared/jobs/delayed-execution-gate'
import { createJobRegistry } from '#/shared/jobs/registry'
import { createJobWorker } from '#/shared/jobs/worker'
import {
  quarantineExhaustedJob,
  quarantineJobDirect,
  createRedriveJob,
  listQuarantinedJobs,
} from '#/shared/jobs/failure-quarantine'
import {
  createProcessingRouter,
  type ProcessingRouter,
} from '#/shared/routing/processing-router'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
} from '#/shared/auth/system-execution-policy'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
  googleConnectionId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '#/contexts/review/domain/types'
import type { GoogleReviewApiPort } from '#/contexts/review/application/ports/google-review-api.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PublishReplyJobData } from '#/contexts/review/application/ports/reply-queue.port'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import { createAtomicReplyCommandStore } from '#/contexts/review/infrastructure/reply-command-store'
import { createPublishReplyHandler } from '#/contexts/review/infrastructure/jobs/publish-reply.job'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

// Queue names are unique to this suite — the shared Redis hosts other suites'
// queues, and BullMQ cross-talk is ruled out by name.
const QUEUE_A = 'bqc46-it-a-domain-events'
const QUEUE_B = 'bqc46-it-b-default'
const QUAR_B = 'bqc46-it-b-quarantine'
const QUAR_C = 'bqc46-it-c-quarantine'
const QUAR_D = 'bqc46-it-d-quarantine'
const QUEUE_E = 'bqc46-it-e-default'
const QUAR_E = 'bqc46-it-e-quarantine'
const QUEUE_F = 'bqc46-it-f-default'
const QUAR_F = 'bqc46-it-f-quarantine'

const OUTBOX_ORG = 'org-bqc46-faults'
const EVENT_TYPE = 'test.bqc46.fault'

const db = getDb()
const repo = createOutboxRepository(db)

/** The 3.2 policy gate is not the fault surface under test — stub it to an
 * allow so each condition isolates the 4.2 routing gate / handler behavior. */
const POLICY_ALLOW: DelayedDecision = {
  outcome: 'allow',
  allowed: true,
  reason: 'allowed',
  action: 'system:review.sync',
  policyVersion: 'bqc-4.6-faults',
  freshRead: true,
}

let redis: Redis | undefined
let redisAvailable = false
const queues: Partial<Record<string, Queue>> = {}

function q(name: string): Queue {
  const queue = queues[name]
  if (!queue) throw new Error(`queue ${name} not initialized (Redis unavailable)`)
  return queue
}

async function obliterateQuietly(queue: Queue | undefined): Promise<void> {
  if (!queue) return
  try {
    await queue.obliterate({ force: true })
  } catch {
    // best-effort cleanup — the queue may not exist yet
  }
}

beforeAll(async () => {
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, connectTimeout: 2000 })
  try {
    await redis.ping()
    redisAvailable = true
  } catch {
    redisAvailable = false
    return
  }
  const connection = redis as unknown as import('bullmq').ConnectionOptions
  for (const name of [
    QUEUE_A,
    QUEUE_B,
    QUAR_B,
    QUAR_C,
    QUAR_D,
    QUEUE_E,
    QUAR_E,
    QUEUE_F,
    QUAR_F,
  ]) {
    queues[name] = new Queue(name, { connection })
  }
  for (const name of Object.keys(queues)) await obliterateQuietly(queues[name])
})

afterAll(async () => {
  for (const name of Object.keys(queues)) await obliterateQuietly(queues[name])
  for (const name of Object.keys(queues)) await queues[name]?.close()
  redis?.disconnect()
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${OUTBOX_ORG}`)
})

// ── Shared helpers ───────────────────────────────────────────────────

/** A port nothing listens on: bind 0.0.0.0:0, read the assigned port, close. */
function findDeadPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('no address'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

/** Connection options whose commands fail fast — no offline queue, no retry. */
function deadConnectionOptions(port: number) {
  return {
    host: '127.0.0.1',
    port,
    lazyConnect: true,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    connectTimeout: 300,
  }
}

async function insertOutboxEvent(createdAt: Date): Promise<string> {
  const result = await db.execute(sql`
    INSERT INTO outbox_events
      (event_type, event_version, payload, organization_id, source_context, source_aggregate_id, created_at)
    VALUES
      (${EVENT_TYPE}, 1, '{"resourceId":"r-bqc46"}'::jsonb, ${OUTBOX_ORG}, 'bqc46', 'agg-1', ${createdAt})
    RETURNING id
  `)
  return (result.rows[0] as { id: string }).id
}

/** Epoch ms of a row's lease columns, for clock-skew-proof comparisons. */
async function leaseRow(id: string): Promise<{
  leaseOwner: string | null
  leaseExpiresAtMs: number | null
  publishedAtMs: number | null
}> {
  const result = await db.execute(sql`
    SELECT lease_owner AS "leaseOwner",
           (EXTRACT(EPOCH FROM lease_expires_at) * 1000)::float8 AS "leaseExpiresAtMs",
           (EXTRACT(EPOCH FROM published_at) * 1000)::float8 AS "publishedAtMs"
    FROM outbox_events WHERE id = ${id}
  `)
  return result.rows[0] as {
    leaseOwner: string | null
    leaseExpiresAtMs: number | null
    publishedAtMs: number | null
  }
}

function syncJob(id: string, property: string, org: string): Job {
  return {
    id,
    name: 'sync-property-reviews',
    queueName: 'default',
    data: { propertyId: property, organizationId: org },
    attemptsMade: 0,
    opts: {},
  } as unknown as Job
}

const WAIT = { timeout: 15_000, interval: 50 } as const

/** (b)/(e)/(f): install the 3.2 policy allow stub around each gated-dispatch test. */
function stubPolicyAllow(): void {
  beforeEach(() => {
    initDelayedExecutionPolicy({ decide: async () => POLICY_ALLOW })
  })
  afterEach(() => {
    resetDelayedExecutionPolicy()
  })
}

/** (e)/(f): gated sync-property-reviews dispatch with a spy handler and the
 * direct-quarantine callback wired to the suite's dead-letter queue. */
function gatedSyncDispatch(
  queueName: string,
  quarantineName: string,
  router: ProcessingRouter,
) {
  const routing: JobRoutingGate = {
    router,
    cell: 'us',
    quarantine: async (job, policyReason) => {
      await quarantineJobDirect(q(quarantineName), job, policyReason)
    },
  }
  const registry = createJobRegistry()
  const handler = vi.fn(async (_job: Job) => {})
  registry.register('sync-property-reviews', handler)
  const dispatch = createGatedJobHandler(queueName, registry, undefined, routing)
  return { dispatch, handler }
}

// ── (a) Queue unavailable at publish ─────────────────────────────────

describe('(a) queue unavailable at publish (BQC-4.6)', () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM outbox_events`)
  })

  it('the claimed event is not marked published; after lease expiry a healthy in-cell relay re-claims and publishes it', async () => {
    if (!redisAvailable) return
    const eventId = await insertOutboxEvent(new Date(Date.now() - 60_000))

    // The cell's domain-events queue, but its Redis is unreachable (dead
    // port — the shared Redis is never touched).
    const deadQueue = new Queue(QUEUE_A, {
      connection: deadConnectionOptions(await findDeadPort()),
    })
    deadQueue.on('error', () => {}) // tolerate the refused-connection error event
    try {
      const deadRelay = createOutboxRelay(repo, deadQueue, {
        relayId: 'bqc46-a-dead',
        leaseDurationMs: 30_000,
      })
      await deadRelay.poll()

      // Claimed but NOT published — the lease owns the row until expiry.
      const mid = await leaseRow(eventId)
      expect(mid.publishedAtMs).toBeNull()
      expect(mid.leaseOwner).toBe('bqc46-a-dead')

      // The lease expires (backdated — no wall-clock sleep) ...
      await db.execute(sql`
        UPDATE outbox_events
        SET lease_expires_at = NOW() - INTERVAL '1 second'
        WHERE id = ${eventId}
      `)

      // ... and a healthy handle of the SAME queue (the cell's queue; no
      // second queue or region exists) re-claims and publishes.
      const healthyRelay = createOutboxRelay(repo, q(QUEUE_A), {
        relayId: 'bqc46-a-healthy',
        leaseDurationMs: 30_000,
      })
      await healthyRelay.poll()

      const after = await leaseRow(eventId)
      expect(after.publishedAtMs).not.toBeNull()
      expect(after.leaseOwner).toBeNull()

      const jobs = await q(QUEUE_A).getJobs(['waiting', 'delayed', 'prioritized'])
      expect(jobs).toHaveLength(1)
      expect(jobs[0]!.queueName).toBe(QUEUE_A)
      expect(jobs[0]!.id).toBe(eventId)
      expect(jobs[0]!.name).toBe(EVENT_TYPE)
    } finally {
      await deadQueue.close().catch(() => {})
    }
  })
})

// ── (b) Database unavailable at dispatch ─────────────────────────────

describe('(b) database unavailable at dispatch (BQC-4.6)', () => {
  stubPolicyAllow()

  it('the routing gate propagates the DB failure: the job throws (transient), BullMQ retries, and exhaustion lands in the 3.6 quarantine', async () => {
    if (!redisAvailable) return
    const dbDown = new Error('connect ECONNREFUSED 127.0.0.1:5432 — database unreachable')
    const router = createProcessingRouter({
      loadPropertyRouting: async () => {
        throw dbDown
      },
      cell: 'us',
    })
    // The gate's direct-quarantine path must NOT fire for a transient throw.
    const gateQuarantine = vi.fn(async (_job: Job, _policyReason: string) => {})
    const routing: JobRoutingGate = { router, cell: 'us', quarantine: gateQuarantine }
    const registry = createJobRegistry()
    const handler = vi.fn(async (_job: Job) => {})
    registry.register('sync-property-reviews', handler)
    const dispatch = createGatedJobHandler(QUEUE_B, registry, undefined, routing)

    // Direct proof: the dispatch THROWS — a BullMQ-visible transient failure,
    // not a swallowed wrong outcome and not a fail-closed quarantine.
    await expect(dispatch(syncJob('bqc46-b-direct', 'prop-b', 'org-b'))).rejects.toThrow(
      /ECONNREFUSED/,
    )
    expect(handler).not.toHaveBeenCalled()
    expect(gateQuarantine).not.toHaveBeenCalled()

    // Full BullMQ proof against the real worker wiring: the job fails, is
    // retried, and at attempts-exhaustion the 3.6 'failed' path quarantines.
    const worker = createJobWorker(QUEUE_B, dispatch, 1, q(QUAR_B))
    if (!worker) throw new Error('worker unavailable (REDIS_URL missing)')
    try {
      await q(QUEUE_B).add(
        'sync-property-reviews',
        { propertyId: 'prop-b', organizationId: 'org-b' },
        {
          jobId: 'bqc46-b-1',
          attempts: 2,
          backoff: { type: 'fixed', delay: 50 },
          removeOnFail: { count: 10 },
        },
      )

      await vi.waitFor(async () => {
        expect(await listQuarantinedJobs(q(QUAR_B))).toHaveLength(1)
      }, WAIT)

      const [entry] = await listQuarantinedJobs(q(QUAR_B))
      expect(entry!.envelope.jobName).toBe('sync-property-reviews')
      // Parked on its OWN cell's queues — no fallback queue exists.
      expect(entry!.envelope.originalQueue).toBe(QUEUE_B)
      expect(entry!.envelope.attemptsMade).toBe(2)
      // A transient infra failure is NOT a policy failure.
      expect(entry!.envelope.policyReason).toBeUndefined()
      // Content-safe failure evidence: error name + first line, ≤ 200 chars.
      expect(entry!.envelope.failedReason).toMatch(/^Error: connect ECONNREFUSED/)
      expect(entry!.envelope.failedReason.length).toBeLessThanOrEqual(200)
      expect(entry!.envelope.failedReason).not.toMatch(/\n| {4}at /)
      // Catalogue-known payload passes through identifier-only.
      expect(Object.keys(entry!.envelope.data as Record<string, unknown>).sort()).toEqual(
        ['organizationId', 'propertyId'],
      )

      // BullMQ retried exactly to the configured budget, then failed.
      const failed = await q(QUEUE_B).getJob('bqc46-b-1')
      expect(failed).toBeDefined()
      expect(await failed!.getState()).toBe('failed')
      expect(failed!.attemptsMade).toBe(2)

      // Across the whole outage the handler NEVER ran and the gate NEVER
      // quarantined (transient ≠ policy rejection).
      expect(handler).not.toHaveBeenCalled()
      expect(gateQuarantine).not.toHaveBeenCalled()
    } finally {
      await worker.close()
    }
  })
})

// ── (c) Provider (GBP) down ──────────────────────────────────────────

const ORG_C = organizationId('org-bqc46-faults-cc000001')
const PROP_C = propertyId('4d000000-0000-0000-0000-000000000001')
const CONN_C = googleConnectionId('4d000000-0000-0000-0000-000000000002')
const REVIEW_C = reviewId('4d000000-0000-0000-0000-000000000010')
const REPLY_C = replyId('4d000000-0000-0000-0000-000000000020')
const USER_C = userId('user-bqc46-faults-cc00001')
const NOW_C = new Date('2026-07-18T12:00:00.000Z')

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

function makeReviewC(): Review {
  return {
    id: REVIEW_C,
    organizationId: ORG_C,
    propertyId: PROP_C,
    platform: 'google',
    externalId: 'ext-bqc46-c-1',
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: CONN_C,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt: NOW_C,
    expiresAt: new Date(NOW_C.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW_C,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW_C,
    lastFetchedAt: NOW_C,
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
    createdAt: NOW_C,
    updatedAt: NOW_C,
  }
}

function makeReplyC(): Reply {
  return {
    id: REPLY_C,
    reviewId: REVIEW_C,
    organizationId: ORG_C,
    text: 'Thank you for the kind words!',
    status: 'approved',
    source: 'internal',
    createdBy: USER_C,
    approvedBy: USER_C,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW_C,
    approvedAt: NOW_C,
    publishedAt: null,
    publicationState: 'authorized',
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW_C,
    updatedAt: NOW_C,
  }
}

function publishJob(attemptsMade: number): Job<PublishReplyJobData> {
  return {
    id: `bqc46-c-attempt-${attemptsMade}`,
    name: 'publish-reply',
    queueName: 'default',
    data: { replyId: REPLY_C, organizationId: ORG_C },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<PublishReplyJobData>
}

describe('(c) provider (GBP) down (BQC-4.6)', () => {
  /** Children before the parent org (FK) so a crashed previous run re-seeds cleanly. */
  async function cleanOrgC(): Promise<void> {
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORG_C}`)
  }

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await cleanOrgC()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG_C}, 'BQC46 Faults C', 'bqc46-faults-c', NOW())
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
      VALUES (${PROP_C}, ${ORG_C}, 'BQC46 Property C', 'bqc46-prop-c', 'UTC', NOW(), NOW())
    `)
    await db.execute(sql`
      INSERT INTO google_connections
        (id, organization_id, google_account_id, google_email,
         encrypted_access_token, encrypted_refresh_token, token_expires_at,
         scopes, connected_by)
      VALUES
        (${CONN_C}, ${ORG_C}, 'bqc46-google-account-c', 'bqc46-c@example.test',
         'enc-access', 'enc-refresh', NOW() + INTERVAL '1 hour',
         ARRAY['https://www.googleapis.com/auth/business.manage'], ${USER_C})
    `)
  })

  afterAll(async () => {
    clearEventSchemas()
    await cleanOrgC()
  })

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG_C}`)
  })

  it('retryable 5xx rethrows through attempts; an ambiguous final attempt persists publish_failed; the 3.6 envelope is content-safe with no policyReason; only the cell provider is ever called', async () => {
    if (!redisAvailable) return
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    await reviewRepo.upsert(makeReviewC())
    await replyRepo.upsert(makeReplyC())

    // GBP down: two 5xx responses (retryable class), then the provider stops
    // responding at all (timeout — ambiguous class on the final attempt).
    const gbp5xx = {
      _tag: 'IntegrationError',
      code: 'gbp_api_error',
      message: 'GBP responded 503',
      context: { status: 503 },
    }
    const gbpTimeout = new Error('The operation was aborted')
    gbpTimeout.name = 'AbortError'
    const replyToReview = vi
      .fn()
      .mockRejectedValueOnce(gbp5xx)
      .mockRejectedValueOnce(gbp5xx)
      .mockRejectedValueOnce(gbpTimeout)
    const googleReviewApi: GoogleReviewApiPort = {
      fetchReviews: async () => [],
      replyToReview,
    }
    const handler = createPublishReplyHandler({
      replyRepo,
      reviewRepo,
      googleReviewApi,
      replyCommandStore: createAtomicReplyCommandStore(db, silentEvents),
      clock: () => NOW_C,
      idGen: () => replyId('4d000000-0000-0000-0000-000000000099'),
      staffPublicApi: {} as unknown as StaffPublicApi,
    })

    // Attempt 1 (5xx → retryable): rethrow = BullMQ retry; the row returns to
    // 'authorized' (re-claimable by the next attempt or a quarantine redrive).
    await expect(handler(publishJob(0))).rejects.toBe(gbp5xx)
    let row = await replyRepo.findById(REPLY_C, ORG_C)
    expect(row!.status).toBe('approved')
    expect(row!.publicationState).toBe('authorized')
    expect(row!.publicationAttempts).toBe(1)

    // Attempt 2 (5xx → retryable): same in-cell retry posture.
    await expect(handler(publishJob(1))).rejects.toBe(gbp5xx)
    row = await replyRepo.findById(REPLY_C, ORG_C)
    expect(row!.publicationState).toBe('authorized')
    expect(row!.publicationAttempts).toBe(2)

    // Attempt 3 = final (timeout → ambiguous): publish_failed persisted with
    // the 3.8 reconcile schedule; the job rethrows into BullMQ exhaustion.
    await expect(handler(publishJob(2))).rejects.toBe(gbpTimeout)
    row = await replyRepo.findById(REPLY_C, ORG_C)
    expect(row!.status).toBe('publish_failed')
    expect(row!.publicationState).toBe('ambiguous')
    expect(row!.publicationLastErrorClass).toBe('ambiguous')
    expect(row!.reconcileDueAt).not.toBeNull()
    expect(row!.reconcileDueAt!.getTime()).toBeGreaterThan(Date.now())

    // The publish_failed fact is persisted identifier-only (3.3/3.8 states).
    const facts = await db.execute(sql`
      SELECT payload FROM outbox_events
      WHERE organization_id = ${ORG_C} AND event_type = 'review.reply.publish_failed'
    `)
    expect(facts.rows).toHaveLength(1)
    const payload = facts.rows[0]!.payload as Record<string, unknown>
    expect(payload.replyId).toBe(REPLY_C)
    expect(payload.reviewId).toBe(REVIEW_C)
    expect(payload.propertyId).toBe(PROP_C)
    expect('text' in payload).toBe(false)

    // Every call hit the cell's ONE provider binding — no alternate provider,
    // endpoint, or region was ever invoked (4.3: nothing to fall back to).
    expect(replyToReview).toHaveBeenCalledTimes(3)
    const bindings = new Set(replyToReview.mock.calls.map((call) => call[1] as string))
    expect(bindings).toEqual(new Set([CONN_C as string]))

    // The 3.6 dead-letter envelope holds the exhausted job: no policyReason
    // (a provider outage is not a policy failure), identifier-only payload,
    // content-safe failedReason.
    const exhausted = {
      ...publishJob(2),
      id: 'bqc46-c-exhausted',
      attemptsMade: 3,
    } as Job
    const outcome = await quarantineExhaustedJob(q(QUAR_C), exhausted, gbpTimeout)
    expect(outcome.quarantined).toBe(true)
    const [entry] = await listQuarantinedJobs(q(QUAR_C))
    expect(entry!.envelope.jobName).toBe('publish-reply')
    expect(entry!.envelope.originalQueue).toBe('default')
    expect(entry!.envelope.attemptsMade).toBe(3)
    expect(entry!.envelope.policyReason).toBeUndefined()
    expect(entry!.envelope.failedReason).toBe('AbortError: The operation was aborted')
    expect(entry!.envelope.failedReason.length).toBeLessThanOrEqual(200)
    expect(entry!.envelope.data).toEqual({ replyId: REPLY_C, organizationId: ORG_C })
  })
})

// ── (d) Aging / visibility ───────────────────────────────────────────

describe('(d) parked work is operator-visible (BQC-4.6 / 3.7 metrics)', () => {
  it('the health snapshot reports the unpublished event age and the quarantined job with a content-safe reason', async () => {
    if (!redisAvailable) return
    await db.execute(sql`DELETE FROM outbox_events`)

    // Parked outbox work: one unpublished event, five minutes old.
    await insertOutboxEvent(new Date(Date.now() - 5 * 60_000))

    // Parked queue work: one exhausted job in the dead-letter quarantine.
    const parked = syncJob('bqc46-d-1', 'prop-d', 'org-d')
    const exhausted = {
      ...parked,
      attemptsMade: 3,
      opts: { attempts: 3 },
    } as Job
    const outcome = await quarantineExhaustedJob(
      q(QUAR_D),
      exhausted,
      new Error('provider timeout'),
    )
    expect(outcome.quarantined).toBe(true)

    const snapshot = await createHealthChecker(db, repo, {
      quarantineQueue: q(QUAR_D),
    }).check()

    expect(snapshot.outbox.unpublishedCount).toBe(1)
    expect(snapshot.outbox.oldestUnpublishedAgeMs).not.toBeNull()
    expect(snapshot.outbox.oldestUnpublishedAgeMs!).toBeGreaterThanOrEqual(4 * 60_000)
    expect(snapshot.outbox.expiredLeaseCount).toBe(0)
    expect(snapshot.quarantine).not.toBeNull()
    expect(snapshot.quarantine!.count).toBe(1)
    expect(snapshot.quarantine!.oldestAgeMs).not.toBeNull()
    expect(snapshot.quarantine!.oldestAgeMs!).toBeGreaterThanOrEqual(0)

    // The operator-visible failure evidence carries no content and no stack.
    const [entry] = await listQuarantinedJobs(q(QUAR_D))
    expect(entry!.envelope.failedReason).toBe('Error: provider timeout')
    expect(entry!.envelope.failedReason.length).toBeLessThanOrEqual(200)
  })
})

// ── (e) Resume / reconcile in-cell ───────────────────────────────────

describe('(e) resume/reconcile in-cell (BQC-4.6)', () => {
  stubPolicyAllow()

  it('a sync job quarantined during the DB outage redrives onto its original queue and completes — handler runs exactly once across the saga', async () => {
    if (!redisAvailable) return
    let dbUp = false
    const router = createProcessingRouter({
      loadPropertyRouting: async () => {
        if (!dbUp)
          throw new Error('connect ECONNREFUSED 127.0.0.1:5432 — database unreachable')
        return { processingRegion: 'us', routingPolicyVersion: 2 }
      },
      cell: 'us',
    })
    const { dispatch, handler } = gatedSyncDispatch(QUEUE_E, QUAR_E, router)
    const worker = createJobWorker(QUEUE_E, dispatch, 1, q(QUAR_E))
    if (!worker) throw new Error('worker unavailable (REDIS_URL missing)')
    try {
      // Phase 1 — DB down: one attempt, exhausted → parked in quarantine.
      await q(QUEUE_E).add(
        'sync-property-reviews',
        { propertyId: 'prop-e', organizationId: 'org-e' },
        { jobId: 'bqc46-e-1', attempts: 1, removeOnFail: { count: 10 } },
      )
      await vi.waitFor(async () => {
        expect(await listQuarantinedJobs(q(QUAR_E))).toHaveLength(1)
      }, WAIT)
      expect(handler).not.toHaveBeenCalled()

      // Phase 2 — DB healthy; the operator redrives the quarantined job.
      dbUp = true
      const [entry] = await listQuarantinedJobs(q(QUAR_E))
      const redrive = createRedriveJob(q(QUAR_E), (name) =>
        name === QUEUE_E ? q(QUEUE_E) : undefined,
      )
      const redriven = await redrive(entry!.quarantineJobId)
      expect(redriven.redriven).toBe(true)
      if (!redriven.redriven) throw new Error('unreachable')
      expect(redriven.targetQueue).toBe(QUEUE_E)

      // Move semantics: the quarantine no longer holds it.
      await vi.waitFor(async () => {
        expect(await listQuarantinedJobs(q(QUAR_E))).toHaveLength(0)
      }, WAIT)

      // The redriven job dispatches successfully on its ORIGINAL queue —
      // handler runs exactly once across the whole saga.
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), WAIT)
      const received = handler.mock.calls[0]![0] as Job
      const meta = (
        received.data as {
          redriveMetadata: { redrivenFrom: string; originalQuarantineId: string }
        }
      ).redriveMetadata
      expect(meta.redrivenFrom).toBe('quarantine')
      expect(meta.originalQuarantineId).toBe(entry!.quarantineJobId)
      expect(received.id).toBe(redriven.jobId)

      // The job reached its terminal state on the same queue — it never left
      // the cell, and no duplicate execution occurred.
      const job = await q(QUEUE_E).getJob(redriven.jobId ?? '')
      expect(job).toBeDefined()
      expect(await job!.getState()).toBe('completed')
    } finally {
      await worker.close()
    }
  })
})

// ── (f) Denied Europe property (the §4.6 repeat) ─────────────────────

const ORG_F = 'org-bqc46-faults-ff000001'
const PROP_EU = '4e000000-0000-0000-0000-000000000001'

describe('(f) denied Europe property (BQC-4.6 repeat)', () => {
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG_F}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORG_F}`)
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG_F}, 'BQC46 Faults F', 'bqc46-faults-f', NOW())
    `)
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
      VALUES (${PROP_EU}, ${ORG_F}, 'BQC46 Europe Property', 'bqc46-prop-eu', 'UTC', NOW(), NOW())
    `)
    await db.execute(sql`
      UPDATE properties
      SET processing_region = 'europe', processing_region_source = 'country_default',
          routing_policy_version = 1, processing_region_resolved_at = NOW(),
          country_code = 'DE', country_source = 'google_address'
      WHERE id = ${PROP_EU}
    `)
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG_F}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORG_F}`)
  })

  stubPolicyAllow()

  it('the 4.2 gate quarantines with routing_blocked:region_denied, the handler never runs, and a redrive without a region approval blocks again', async () => {
    if (!redisAvailable) return
    // The REAL production wiring: drizzle adapter → ProcessingRouter.
    const router = createProcessingRouter({
      loadPropertyRouting: createPropertyRoutingLoader({ db }),
      cell: 'us',
    })
    const { dispatch, handler } = gatedSyncDispatch(QUEUE_F, QUAR_F, router)

    await q(QUEUE_F).add(
      'sync-property-reviews',
      { propertyId: PROP_EU, organizationId: ORG_F },
      { jobId: 'bqc46-f-1' },
    )
    const [job] = await q(QUEUE_F).getJobs(['waiting'])
    expect(job).toBeDefined()

    // First dispatch: fail closed — quarantined, no handler, no throw.
    await expect(dispatch(job!)).resolves.toBeUndefined()
    await job!.remove() // the worker acks the gated job (dispatch returned)

    let entries = await listQuarantinedJobs(q(QUAR_F))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.envelope.policyReason).toBe('routing_blocked:region_denied')
    expect(entries[0]!.envelope.failedReason).toBe(
      'GateRejected: routing_blocked:region_denied',
    )
    expect(entries[0]!.envelope.originalQueue).toBe(QUEUE_F)
    expect(entries[0]!.envelope.data).toMatchObject({
      propertyId: PROP_EU,
      organizationId: ORG_F,
    })
    expect(handler).not.toHaveBeenCalled()

    // Redrivable in principle (an operator would do this after a region
    // approval): the job moves back onto its original queue with metadata.
    const redrive = createRedriveJob(q(QUAR_F), (name) =>
      name === QUEUE_F ? q(QUEUE_F) : undefined,
    )
    const redriven = await redrive(entries[0]!.quarantineJobId)
    expect(redriven.redriven).toBe(true)
    expect(await listQuarantinedJobs(q(QUAR_F))).toHaveLength(0)

    // The region was NOT approved (unchanged in the database): the second
    // dispatch blocks again — no silent override, no fallback to the US cell.
    const waiting = await q(QUEUE_F).getJobs(['waiting'])
    const reJob = waiting.find(
      (candidate) =>
        (candidate.data as { redriveMetadata?: unknown }).redriveMetadata !== undefined,
    )
    expect(reJob).toBeDefined()
    await expect(dispatch(reJob!)).resolves.toBeUndefined()

    entries = await listQuarantinedJobs(q(QUAR_F))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.envelope.policyReason).toBe('routing_blocked:region_denied')
    expect(handler).not.toHaveBeenCalled()
  })
})
