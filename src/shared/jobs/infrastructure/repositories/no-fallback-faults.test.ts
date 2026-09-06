// BQC-4.6 — no-fallback fault proof (real PostgreSQL + real Redis/BullMQ).
//
// fallow-ignore-file boundary-violation
// Architecture proof (BQC-4.6) — deliberate, no expiry. This cross-context
// end-to-end proof BY DESIGN wires review command stores, the outbox relay,
// gated dispatch, and BullMQ workers the same way worker composition does
// (src/worker/index.ts); no single context's zone can own it, and the
// integration project discovers it via the infrastructure/repositories glob.
//
// The surviving fault conditions prove that transport and provider failures
// never select an alternate queue or provider:
//   (a) QUEUE UNAVAILABLE AT PUBLISH — the relay's BullMQ add fails against a
//       dead-port connection; the claimed event is NOT marked published; its
//       lease expires; a healthy handle of the SAME queue reclaims it.
//   (c) PROVIDER (GBP) DOWN — publish-reply against a failing googleReviewApi:
//       5xx is ambiguous and rethrows through BullMQ attempts, while each
//       retry is gated by an exact targeted-absence readback; the final
//       timeout persists publish_failed + publication_state='ambiguous' +
//       reconcile_due_at. The dead-letter envelope has no policyReason and
//       carries identifier-only data. Only one provider binding is called.
//   (d) AGING/VISIBILITY — health metrics read the real parked state:
//       oldestUnpublishedAgeMs > 0 for the unpublished event; quarantine
//       count/age reflect the quarantined job; failedReason is content-safe.
//   (e) RESUME/RECONCILE — a sync job whose dependency is unavailable is
//       quarantined by the worker's terminal-failure path, then redriven via
//       createRedriveJob onto its ORIGINAL queue with a fresh attempt budget;
//       after recovery its protected side effect applies exactly once.
//
// Determinism: relay polls and dispatch closures are invoked directly (never
// interval-driven); lease expiry is simulated by backdating lease_expires_at
// (never a wall-clock sleep); BullMQ worker completion is awaited via bounded
// condition polling (vi.waitFor); queue names are unique to this suite and
// obliterated up front; unavailability uses a dead-port connection — the
// shared Redis is never killed or restarted. Skips cleanly when Redis is
// unreachable (same convention as the BQC-3.6 quarantine suite).

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
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
import { sql } from 'drizzle-orm'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { createGatedJobHandler } from '#/shared/jobs/delayed-execution-gate'
import { createJobRegistry } from '#/shared/jobs/registry'
import { createJobWorker } from '#/shared/jobs/worker'
import {
  quarantineExhaustedJob,
  createRedriveJob,
  listQuarantinedJobs,
} from '#/shared/jobs/failure-quarantine'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
  type DelayedDecision,
} from '#/shared/auth/system-execution-policy'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
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
import { createGoogleReplyObservationStore } from '#/contexts/review/infrastructure/google-reply-observation-store'
import { createPublishReplyHandler } from '#/contexts/review/infrastructure/jobs/publish-reply.job'
import { reviewReplyPublicationRequested } from '#/contexts/review/domain/events'
import { AMBIGUOUS_RECONCILE_DELAY_MS } from '#/contexts/review/domain/reply-publication-workflow'

// Queue names are unique to this suite — the shared Redis hosts other suites'
// queues, and BullMQ cross-talk is ruled out by name.
const QUEUE_A = 'bqc46-it-a-domain-events'
const QUAR_C = 'bqc46-it-c-quarantine'
const QUAR_D = 'bqc46-it-d-quarantine'
const QUEUE_E = 'bqc46-it-e-default'
const QUAR_E = 'bqc46-it-e-quarantine'

const OUTBOX_ORG = 'org-bqc46-faults'
const EVENT_TYPE = 'test.bqc46.fault'

const db = getDb()
const repo = createOutboxRepository(db)

/** The delayed execution policy is not the fault surface under test; allow it
 * so each condition isolates the surviving transport or provider behavior. */
const POLICY_ALLOW: DelayedDecision = {
  outcome: 'allow',
  allowed: true,
  reason: 'allowed',
  action: 'system:review.sync',
  policyVersion: 'bqc-4.6-faults',
  freshRead: true,
}

let redisLease: RedisTestLease | undefined
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
  // BQC-6.1: lease-guarded Redis — refuses remote/managed hosts; skips cleanly
  // when the local Redis is unavailable. Obliterates suite-unique queues only.
  redisLease = await acquireRedisTestLease()
  redisAvailable = redisLease.available
  const redis = redisLease.redis
  if (!redisAvailable || !redis) return
  const connection = redis as unknown as import('bullmq').ConnectionOptions
  for (const name of [QUEUE_A, QUAR_C, QUAR_D, QUEUE_E, QUAR_E]) {
    queues[name] = new Queue(name, { connection })
  }
  for (const name of Object.keys(queues)) await obliterateQuietly(queues[name])
})

afterAll(async () => {
  for (const name of Object.keys(queues)) await obliterateQuietly(queues[name])
  for (const name of Object.keys(queues)) await queues[name]?.close()
  redisLease?.release()
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

/** (e): install the delayed execution policy allow stub around gated dispatch. */
function stubPolicyAllow(): void {
  beforeEach(() => {
    initDelayedExecutionPolicy({ decide: async () => POLICY_ALLOW })
  })
  afterEach(() => {
    resetDelayedExecutionPolicy()
  })
}

// ── (a) Queue unavailable at publish ─────────────────────────────────

describe('(a) queue unavailable at publish (BQC-4.6)', () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM outbox_events`)
  })

  it('leaves a claimed event unpublished until a healthy relay reclaims it on the same queue', async () => {
    if (!redisAvailable) return
    const eventId = await insertOutboxEvent(new Date(Date.now() - 60_000))

    // The deployment's domain-events queue, but its Redis is unreachable
    // (dead port — the shared Redis is never touched).
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

      // ... and a healthy handle of the SAME queue reclaims and publishes.
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

// ── (c) Provider (GBP) down ──────────────────────────────────────────

const ORG_C = organizationId('org-bqc46-faults-cc000001')
const PROP_C = propertyId('46c00000-0000-4000-8000-000000000001')
const CONN_C = googleConnectionId('46c00000-0000-4000-8000-000000000002')
const REVIEW_C = reviewId('46c00000-0000-4000-8000-000000000010')
const REPLY_C = replyId('46c00000-0000-4000-8000-000000000020')
const USER_C = userId('user-bqc46-faults-cc00001')
const NOW_C = new Date('2026-07-18T12:00:00.000Z')
// Command-store attempt timestamps use the real database clock; keep the
// deterministic provider observation after them so the absence evidence is
// causally newer than every attempted send.
const PROVIDER_OBSERVED_AT_C = new Date('2027-01-18T12:00:00.000Z')

function makeReviewC(): Review {
  return {
    id: REVIEW_C,
    organizationId: ORG_C,
    propertyId: PROP_C,
    platform: 'google',
    externalId: 'ext-bqc46-c-1',
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: CONN_C,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW_C,
    expiresAt: new Date('2027-07-18T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW_C,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW_C,
    lastFetchedAt: NOW_C,
    contentExpiresAt: new Date('2027-07-18T12:00:00.000Z'),
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
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
    status: 'pending_approval',
    source: 'internal',
    createdBy: USER_C,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: NOW_C,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW_C,
    updatedAt: NOW_C,
  }
}

function publishJob(attemptsMade: number): Job<PublishReplyJobData> {
  return {
    // BullMQ retries preserve one job identity across every attempt. The
    // publication workflow relies on that serialization authority.
    id: 'bqc46-c-publish',
    name: 'publish-reply',
    queueName: 'default',
    data: {
      replyId: REPLY_C,
      organizationId: ORG_C,
      publicationCycle: 1,
      propertyId: PROP_C,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      baseObservationRevision: 0,
    },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<PublishReplyJobData>
}

describe('(c) provider (GBP) down (BQC-4.6)', () => {
  /** Children before the parent org (FK) so a crashed previous run re-seeds cleanly. */
  async function cleanOrgC(): Promise<void> {
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG_C}`)
    await db.execute(
      sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${ORG_C}`,
    )
    await db.execute(
      sql`DELETE FROM google_reply_observations WHERE organization_id = ${ORG_C}`,
    )
    await db.execute(
      sql`DELETE FROM reply_publication_attempts WHERE organization_id = ${ORG_C}`,
    )
    await withPublicationAuthorizationFixtureMutation(() =>
      db.execute(
        sql`DELETE FROM reply_publication_authorizations WHERE organization_id = ${ORG_C}`,
      ),
    )
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG_C}`)
    await deleteTestOrganizations(db, [ORG_C])
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
        (id, organization_id, google_subject,
         encrypted_access_token, encrypted_refresh_token, token_expires_at,
         scopes, connected_by)
      VALUES
        (${CONN_C}, ${ORG_C}, 'bqc46-google-subject-c',
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
    await db.execute(
      sql`DELETE FROM google_reply_observation_heads WHERE organization_id = ${ORG_C}`,
    )
    await db.execute(
      sql`DELETE FROM google_reply_observations WHERE organization_id = ${ORG_C}`,
    )
    await db.execute(
      sql`DELETE FROM reply_publication_attempts WHERE organization_id = ${ORG_C}`,
    )
    await withPublicationAuthorizationFixtureMutation(() =>
      db.execute(
        sql`DELETE FROM reply_publication_authorizations WHERE organization_id = ${ORG_C}`,
      ),
    )
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORG_C}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG_C}`)
  })

  it('ambiguous 5xx retries only after targeted absence; the final ambiguity is durable and never falls back', async () => {
    if (!redisAvailable) return
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const savedReview = await reviewRepo.upsert(makeReviewC(), NOW_C)
    expect(savedReview).toMatchObject({ sourceEpoch: 0, sourceRevision: 1 })
    const pendingReply = await replyRepo.upsert(makeReplyC(), NOW_C)
    // Identity authority itself is outside this provider-fault proof. The
    // fixture grants the seeded manager explicitly; production composition
    // injects the real transaction-bound, fail-closed authority.
    const replyCommandStore = createAtomicReplyCommandStore(
      db,
      () => new Date(),
      async () => true,
    )
    const authorizedReply = await replyCommandStore.markPublicationAuthorized(
      pendingReply,
      { status: 'approved', approvedBy: USER_C, approvedAt: NOW_C },
      {
        lifecycleEvent: null,
        publicationIntent: reviewReplyPublicationRequested({
          replyId: REPLY_C,
          reviewId: REVIEW_C,
          propertyId: PROP_C,
          organizationId: ORG_C,
          userId: USER_C,
          publicationCycle: 1,
          sourceEpoch: savedReview.sourceEpoch,
          materialReviewRevision: savedReview.sourceRevision,
          baseObservationRevision: 0,
          occurredAt: NOW_C,
        }),
      },
      NOW_C,
    )
    expect(authorizedReply).not.toBeNull()
    const authorization = await db.execute(sql`
      SELECT publication_cycle::int AS "publicationCycle",
             source_epoch AS "sourceEpoch",
             material_review_revision::int AS "materialReviewRevision",
             base_observation_revision::int AS "baseObservationRevision"
      FROM reply_publication_authorizations
      WHERE organization_id = ${ORG_C} AND reply_id = ${REPLY_C}
    `)
    expect(authorization.rows).toEqual([
      {
        publicationCycle: 1,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
      },
    ])

    // GBP down: two 5xx responses, then the provider stops responding at all.
    // Each 5xx is an ambiguous provider outcome: BullMQ retries, but the next
    // attempt must first read back an exact targeted absence before resending.
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
      listReviewsPage: async () => ({
        reviews: [],
        totalReviewCount: 0,
        averageRating: null,
        nextCursorRef: null,
      }),
      getReview: async () => ({
        status: 'found',
        review: {
          reviewName: `${GOOGLE_LOCATION_PRIMARY_RESOURCE}/reviews/ext-bqc46-c-1`,
          externalId: 'ext-bqc46-c-1',
          externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
          reviewerName: 'Jane Doe',
          reviewerProfilePhotoUrl: null,
          rating: 5,
          text: 'Great place!',
          translatedText: null,
          languageCode: 'en',
          reviewedAt: NOW_C,
          sourceCreatedAt: NOW_C,
          sourceUpdatedAt: null,
          replyText: null,
          replyUpdatedAt: null,
        },
      }),
      discardReviewCursors: async () => {},
      replyToReview,
    }
    const handler = createPublishReplyHandler({
      replyRepo,
      reviewRepo,
      googleReviewApi,
      googleReplyObservationStore: createGoogleReplyObservationStore(db),
      replyCommandStore,
      clock: () => PROVIDER_OBSERVED_AT_C,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      idGen: () => replyId('4d000000-0000-0000-0000-000000000099'),
      staffPublicApi: {} as unknown as StaffPublicApi,
    })

    // Attempt 1 (5xx → ambiguous): rethrow = BullMQ retry; the row remains
    // sending so the next attempt must reconcile before another provider call.
    await expect(handler(publishJob(0))).rejects.toBe(gbp5xx)
    let row = await replyRepo.findById(REPLY_C, ORG_C)
    expect(row!.status).toBe('approved')
    expect(row!.publicationState).toBe('sending')
    expect(row!.publicationAttempts).toBe(1)

    // Attempt 2 first records a targeted absence, then resends through the same
    // provider binding. Its second 5xx remains ambiguous/sending for one more readback.
    await expect(handler(publishJob(1))).rejects.toBe(gbp5xx)
    row = await replyRepo.findById(REPLY_C, ORG_C)
    expect(row!.publicationState).toBe('sending')
    expect(row!.publicationAttempts).toBe(2)

    // Attempt 3 = final (timeout → ambiguous): publish_failed persisted with
    // the 3.8 reconcile schedule; the job rethrows into BullMQ exhaustion.
    const finalAttemptStartedAt = Date.now()
    await expect(handler(publishJob(2))).rejects.toBe(gbpTimeout)
    const finalAttemptFinishedAt = Date.now()
    row = await replyRepo.findById(REPLY_C, ORG_C)
    expect(row!.status).toBe('publish_failed')
    expect(row!.publicationState).toBe('ambiguous')
    expect(row!.publicationLastErrorClass).toBe('ambiguous')
    expect(row!.reconcileDueAt).not.toBeNull()
    expect(row!.reconcileDueAt!.getTime()).toBeGreaterThanOrEqual(
      finalAttemptStartedAt + AMBIGUOUS_RECONCILE_DELAY_MS,
    )
    expect(row!.reconcileDueAt!.getTime()).toBeLessThanOrEqual(
      finalAttemptFinishedAt + AMBIGUOUS_RECONCILE_DELAY_MS,
    )

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

    // Every call hit the one provider binding — no alternate provider or
    // endpoint was ever invoked.
    expect(replyToReview).toHaveBeenCalledTimes(3)
    const bindings = new Set(
      replyToReview.mock.calls.map((call) => call[0].connectionId as string),
    )
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
    expect(entry!.envelope.data).toEqual(publishJob(2).data)
    expect(entry!.envelope.data).not.toHaveProperty('text')
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

// ── (e) Resume / reconcile ───────────────────────────────────────────

describe('(e) resume/reconcile (BQC-4.6)', () => {
  stubPolicyAllow()

  it('redrives a dependency-failed sync job onto its original queue and applies its side effect exactly once after recovery', async () => {
    if (!redisAvailable) return
    let dbUp = false
    const applySync = vi.fn(async (_job: Job) => {})
    const registry = createJobRegistry()
    registry.register('sync-property-reviews', async (job) => {
      if (!dbUp) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432 — database unreachable')
      }
      return applySync(job)
    })
    const dispatch = createGatedJobHandler(QUEUE_E, registry)
    const worker = createJobWorker(QUEUE_E, dispatch, 1, q(QUAR_E))
    if (!worker) throw new Error('worker unavailable (queue Redis missing)')
    try {
      // Phase 1 — dependency down: one attempt, exhausted and parked through
      // the worker's terminal-failure quarantine path.
      await q(QUEUE_E).add(
        'sync-property-reviews',
        { propertyId: 'prop-e', organizationId: 'org-e' },
        { jobId: 'bqc46-e-1', attempts: 1, removeOnFail: { count: 10 } },
      )
      await vi.waitFor(async () => {
        const entries = await listQuarantinedJobs(q(QUAR_E))
        expect(entries).toHaveLength(1)
        expect(entries[0]!.publicationState).toBe('confirmed_failed')
      }, WAIT)
      expect(applySync).not.toHaveBeenCalled()

      // Phase 2 — dependency healthy; the operator redrives the quarantined job.
      dbUp = true
      const [entry] = await listQuarantinedJobs(q(QUAR_E))
      expect(entry!.envelope.policyReason).toBeUndefined()
      const redrive = createRedriveJob(q(QUAR_E), (name) =>
        name === QUEUE_E ? q(QUEUE_E) : undefined,
      )
      const redriven = await redrive(entry!.quarantineJobId)
      expect(redriven.redriven).toBe(true)
      if (!redriven.redriven) throw new Error('unreachable')
      expect(redriven.targetQueue).toBe(QUEUE_E)

      // Move semantics: quarantine is empty and recovered work applies once.
      await vi.waitFor(async () => {
        expect(await listQuarantinedJobs(q(QUAR_E))).toHaveLength(0)
      }, WAIT)
      await vi.waitFor(() => expect(applySync).toHaveBeenCalledTimes(1), WAIT)
      const received = applySync.mock.calls[0]![0]
      expect(received.data).toMatchObject({
        redriveMetadata: {
          redrivenFrom: 'quarantine',
          originalQuarantineId: entry!.quarantineJobId,
        },
      })
      expect(received.id).toBe(redriven.jobId)

      const job = await q(QUEUE_E).getJob(redriven.jobId ?? '')
      expect(job).toBeDefined()
      expect(await job!.getState()).toBe('completed')
    } finally {
      await worker.close()
    }
  })
})
