// The enrollment replay must take the Property fence before anything a
// concurrent writer takes after it.
//
// Every Review writer locks the Property, then the Review (the documented
// Property -> Reply truth -> Review order), and an authorization change locks
// the Property, then the enrollment rows. The replay used to lock its
// enrollment row and every candidate review first, then reach the Property
// through `lock_review_ai_analysis_head_v1`. An import running while Review
// Analysis was being enabled (closed beta, 2026-09-29) could therefore close a
// cycle, and PostgreSQL aborted one side with a deadlock.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  aiPropertyAggregateSettlements,
  aiReviewAnalysisEnrollments,
  materialReviewRevisions,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createReviewAnalysisEnrollmentAdapter } from '../../replay/enrollment-store.server'
import { AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE } from '../../replay/enrollment-candidates.server'

const NOW = new Date('2026-09-29T17:37:00.000Z')
const ORG = organizationId('ai-enrollment-lock-order-org')
const PROPERTY = propertyId('75000000-0000-4000-8000-000000000001')
const LINEAGE = '75000000-0000-4000-8000-000000000002'
const REVIEWS = [
  '75000000-0000-4000-8000-000000000011',
  '75000000-0000-4000-8000-000000000012',
  '75000000-0000-4000-8000-000000000013',
] as const
const APPLICATION_NAME = 'rk-enrollment-replay-order'
const WRITER_APPLICATION_NAME = 'rk-enrollment-replay-writer'
const FENCE = {
  authorizationLineageId: LINEAGE,
  authorizationStateVersion: 1,
  sourceEpoch: 0,
  reviewAnalysisEpoch: 1,
  analysisStartSequence: 0,
} as const
const WAIT_LIMIT_MS = 5_000

let replayPool: Pool
let writerPool: Pool
let enrollmentId: string

async function clear(): Promise<void> {
  const db = getDb()
  await db.execute(sql`
    DELETE FROM event_consumer_receipts
    WHERE event_id IN (SELECT id FROM outbox_events WHERE organization_id = ${ORG})
  `)
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
  await db.delete(properties).where(eq(properties.id, PROPERTY))
  await deleteTestOrganizations(db, [ORG])
}

function authorization() {
  return {
    organizationId: ORG,
    propertyId: PROPERTY,
    authorizationLineageId: LINEAGE,
    state: 'enabled',
    capabilities: ['review_analysis'],
    capabilityRuntimeProfileVersions: { review_analysis: 'review-analysis-runtime-v1' },
    reviewAnalysisEpoch: 1,
    replyDraftingEpoch: 1,
    propertyTrendsEpoch: 1,
    authorizedSourceEpoch: 0,
    analysisStartSequence: 0,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    processingRegion: 'global',
    providerDeploymentProfileVersion: 'private-beta-global-v2',
    redactionProfileFamily: 'gbp-review-global-v1',
  }
}

/** An enabled Property with three unanalysed text reviews and a queued enrollment. */
async function seedQueuedEnrollment(): Promise<string> {
  const db = getDb()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'AI enrollment lock order', ${ORG}, ${NOW})
  `)
  await db.insert(properties).values({
    id: PROPERTY,
    organizationId: ORG,
    name: 'AI enrollment lock order',
    slug: 'ai-enrollment-lock-order',
    timezone: 'Europe/Sofia',
    countryCode: 'BG',
    profileVersion: 1,
    sourceEpoch: 0,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceEpoch: 0,
    headSequence: 0,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...authorization(),
      stateVersion: 1,
      transitionKind: 'enable',
      actorUserId: 'ai-enrollment-lock-order-actor',
      reasonCode: 'merchant_enabled',
      idempotencyKey: 'ai-enrollment-lock-order-enable',
      requestHash: 'c'.repeat(64),
      occurredAt: NOW,
    })
    await tx.insert(merchantAiEnablement).values({
      ...authorization(),
      stateVersion: 1,
      updatedBy: 'ai-enrollment-lock-order-actor',
      updatedAt: NOW,
    })
  })
  for (const id of REVIEWS) {
    await db.insert(reviews).values({
      id,
      organizationId: ORG,
      propertyId: PROPERTY,
      platform: 'google',
      externalId: `ai-enrollment-lock-order-${id}`,
      reviewerName: 'Synthetic reviewer',
      rating: 4,
      text: 'Synthetic review content',
      languageCode: 'en',
      reviewedAt: NOW,
      contentExpiresAt: new Date('2027-09-29T00:00:00.000Z'),
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 0,
      aiSourceByteLength: 24,
      aiSourceDigest: 'a'.repeat(64),
    })
    await db.insert(materialReviewRevisions).values({
      reviewId: id,
      revision: 1,
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      normalizationVersion: 'legacy-unverified-v0',
      rating: 4,
      normalizedText: 'Synthetic review content',
    })
  }
  const triggerEventId = randomUUID()
  await db.insert(outboxEvents).values({
    id: triggerEventId,
    eventType: 'identity.merchant_ai.changed',
    eventVersion: 1,
    payload: { state: 'enabled' },
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext: 'identity',
    sourceAggregateId: PROPERTY,
    createdAt: NOW,
  })
  const id = randomUUID()
  const applied = await createReviewAnalysisEnrollmentAdapter(
    db,
    () => id,
  ).applyAuthorizationLifecycle({
    eventEnvelopeId: triggerEventId,
    organizationId: ORG,
    propertyId: PROPERTY,
    authorizationState: 'enabled',
    fence: { ...FENCE, replyDraftingEpoch: 1, propertyTrendsEpoch: 1 },
    correlationId: null,
    occurredAt: NOW,
  })
  expect(applied).toEqual({
    status: 'applied',
    enrollment: { status: 'queued', enrollmentId: id },
  })
  return id
}

async function waitForReplayToQueueOnALock(): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS
  for (;;) {
    const result = await writerPool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE application_name = $1 AND wait_event_type = 'Lock'`,
      [APPLICATION_NAME],
    )
    if ((result.rows[0]?.waiting ?? 0) > 0) return
    if (Date.now() > deadline) throw new Error('the replay never queued on a lock')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** SQLSTATE of a pg error, directly or behind Drizzle's query wrapper. */
function errorCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } }).cause
  const code = (error as { code?: unknown }).code ?? cause?.code
  return typeof code === 'string' ? code : 'unknown'
}

type ConcurrentWriter = Readonly<{
  /** What the writer holds on the Property when the replay starts. */
  lockProperty: string
  /** What it takes next, once the replay is queued. */
  lockNext: () => Readonly<{ statement: string; values: unknown[] }>
}>

const reviewImport: ConcurrentWriter = {
  lockProperty: `SELECT lock_review_ai_analysis_head_v1($1, $2::uuid, 0)`,
  lockNext: () => ({
    statement: `SELECT 1 FROM reviews WHERE organization_id = $1 AND id = $2::uuid FOR UPDATE`,
    values: [ORG, REVIEWS[1]],
  }),
}

const authorizationChange: ConcurrentWriter = {
  lockProperty: `SELECT 1 FROM properties WHERE organization_id = $1 AND id = $2::uuid FOR UPDATE`,
  lockNext: () => ({
    statement: `SELECT 1 FROM ai_review_analysis_enrollments
                WHERE organization_id = $1 AND id = $2::uuid FOR UPDATE`,
    values: [ORG, enrollmentId],
  }),
}

beforeAll(() => {
  clearEventSchemas()
  registerAllEventSchemas()
  replayPool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 2,
    application_name: APPLICATION_NAME,
  })
  writerPool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 2,
    application_name: WRITER_APPLICATION_NAME,
  })
})

afterAll(async () => {
  await replayPool.end()
  await writerPool.end()
  await clear()
  clearEventSchemas()
})

beforeEach(async () => {
  await clear()
  enrollmentId = await seedQueuedEnrollment()
})

/**
 * Hold the writer's Property lock, start `run`, wait until it queues on a lock,
 * then take the writer's next lock. A lock-order inversion makes PostgreSQL
 * abort one side with a deadlock.
 */
async function raceWriter<T>(
  writer: ConcurrentWriter,
  run: () => Promise<T>,
  waitForLock = waitForReplayToQueueOnALock,
): Promise<Readonly<{ writerNext: string; outcome: { result: T } | { error: string } }>> {
  const client = await writerPool.connect()
  let outcome: Promise<{ result: T } | { error: string }> | undefined
  let writerNext: string
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL lock_timeout = ${WAIT_LIMIT_MS}`)
    await client.query(writer.lockProperty, [ORG, PROPERTY])
    outcome = run().then(
      (result) => ({ result }),
      (error: unknown) => ({ error: errorCode(error) }),
    )
    await waitForLock()
    const next = writer.lockNext()
    writerNext = await client.query(next.statement, next.values).then(
      () => 'locked',
      (error: unknown) => errorCode(error),
    )
  } finally {
    try {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    // Let the contender finish after releasing the writer's locks, including
    // when observation failed, before the next test removes its fixture.
    await outcome
  }
  return { writerNext, outcome: await outcome }
}

const adapter = () =>
  createReviewAnalysisEnrollmentAdapter(drizzle(replayPool), randomUUID)

describe('Review Analysis enrollment replay lock order', () => {
  it('rolls the writer back when lock observation fails, then permits another race', async () => {
    await expect(
      raceWriter(
        reviewImport,
        async () => 'unused',
        async () => {
          throw new Error('lock observation failed')
        },
      ),
    ).rejects.toThrow('lock observation failed')

    const openTransactions = await replayPool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE application_name = $1 AND state = 'idle in transaction'`,
      [WRITER_APPLICATION_NAME],
    )
    expect(openTransactions.rows).toEqual([{ count: 0 }])

    const race = await raceWriter(reviewImport, () =>
      adapter().reconcile({
        enrollmentId,
        organizationId: ORG,
        expectedFence: FENCE,
        correlationId: enrollmentId,
        occurredAt: NOW,
      }),
    )
    expect(race).toMatchObject({
      writerNext: 'locked',
      outcome: { result: { status: 'replay_started', pinnedRevisionCount: 3 } },
    })
  })

  it.each([
    ['a review import that locks a candidate review', reviewImport],
    ['an authorization change that locks the enrollment', authorizationChange],
  ])('waits behind %s without a deadlock', async (_name, writer) => {
    const race = await raceWriter(writer, () =>
      adapter().reconcile({
        enrollmentId,
        organizationId: ORG,
        expectedFence: FENCE,
        correlationId: enrollmentId,
        occurredAt: NOW,
      }),
    )

    expect(race).toEqual({
      writerNext: 'locked',
      outcome: {
        result: { status: 'replay_started', runId: enrollmentId, pinnedRevisionCount: 3 },
      },
    })
  })
})

describe('Review Analysis authorization lifecycle lock order', () => {
  // A merchant AI transition locks the Property, then the enablement
  // (merchant-ai-transition.ts). The lifecycle consumer of the previous
  // transition used to lock them the other way round in one statement.
  const merchantTransition: ConcurrentWriter = {
    lockProperty: `SELECT 1 FROM properties WHERE organization_id = $1 AND id = $2::uuid FOR UPDATE`,
    lockNext: () => ({
      statement: `SELECT 1 FROM merchant_ai_enablement
                  WHERE organization_id = $1 AND property_id = $2::uuid FOR UPDATE`,
      values: [ORG, PROPERTY],
    }),
  }

  it('waits behind a merchant AI transition without a deadlock', async () => {
    const triggerEventId = randomUUID()
    await getDb()
      .insert(outboxEvents)
      .values({
        id: triggerEventId,
        eventType: 'identity.merchant_ai.changed',
        eventVersion: 1,
        payload: { state: 'enabled' },
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceContext: 'identity',
        sourceAggregateId: PROPERTY,
        createdAt: NOW,
      })

    const race = await raceWriter(merchantTransition, () =>
      adapter().applyAuthorizationLifecycle({
        eventEnvelopeId: triggerEventId,
        organizationId: ORG,
        propertyId: PROPERTY,
        authorizationState: 'enabled',
        fence: { ...FENCE, replyDraftingEpoch: 1, propertyTrendsEpoch: 1 },
        correlationId: null,
        occurredAt: NOW,
      }),
    )

    expect(race).toMatchObject({
      writerNext: 'locked',
      outcome: { result: { status: 'applied' } },
    })
  })
})

describe('Review Analysis history replay recovery', () => {
  async function addReviews(count: number): Promise<void> {
    for (let offset = 0; offset < count; offset += 1_000) {
      await getDb()
        .insert(reviews)
        .values(
          Array.from({ length: Math.min(1_000, count - offset) }, () => {
            const id = randomUUID()
            return {
              id,
              organizationId: ORG,
              propertyId: PROPERTY,
              platform: 'google' as const,
              externalId: id,
              reviewerName: 'Synthetic reviewer',
              rating: 4,
              text: 'Synthetic review content',
              languageCode: 'en',
              reviewedAt: NOW,
              contentExpiresAt: new Date('2027-09-29T00:00:00.000Z'),
              sourceEpoch: 0,
              sourceRevision: 1,
              analysisSequence: 0,
              aiSourceByteLength: 24,
              aiSourceDigest: 'a'.repeat(64),
            }
          }),
        )
    }
  }

  const reconcile = () =>
    adapter().reconcile({
      enrollmentId,
      organizationId: ORG,
      expectedFence: FENCE,
      correlationId: enrollmentId,
      occurredAt: NOW,
    })

  it('refreshes a changed source snapshot and emits the current revision', async () => {
    const db = getDb()
    await db.update(reviews).set({ sourceRevision: 2 }).where(eq(reviews.id, REVIEWS[0]))
    await expect(reconcile()).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: 3,
    })
    const events = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'))
    expect(events.map(({ payload }) => payload)).toContainEqual(
      expect.objectContaining({
        reviewId: REVIEWS[0],
        sourceRevision: 2,
        correlationId: enrollmentId,
      }),
    )
    expect(
      await adapter().readCurrent({ organizationId: ORG, propertyId: PROPERTY }),
    ).toMatchObject({
      state: 'running',
      snapshotRevisionCount: 3,
      enrolledRevisionCount: 3,
    })
  })

  it('catches up an empty refreshed snapshot instead of stalling on expired sources', async () => {
    await getDb()
      .update(reviews)
      .set({ contentExpiresAt: new Date(0) })
      .where(eq(reviews.propertyId, PROPERTY))
    await expect(reconcile()).resolves.toMatchObject({
      status: 'caught_up',
      eligibleRevisionCount: 0,
    })
  })

  it('resumes after a committed page without replaying its sequences or events', async () => {
    const db = getDb()
    const additionalIds = Array.from(
      { length: AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE },
      () => randomUUID(),
    )
    await db.insert(reviews).values(
      additionalIds.map((id) => ({
        id,
        organizationId: ORG,
        propertyId: PROPERTY,
        platform: 'google' as const,
        externalId: id,
        reviewerName: 'Synthetic reviewer',
        rating: 4,
        text: 'Synthetic review content',
        languageCode: 'en',
        reviewedAt: NOW,
        contentExpiresAt: new Date('2027-09-29T00:00:00.000Z'),
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 0,
        aiSourceByteLength: 24,
        aiSourceDigest: 'a'.repeat(64),
      })),
    )
    await expect(reconcile()).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE,
    })
    const [firstPage] = await db
      .select()
      .from(aiReviewAnalysisEnrollments)
      .where(eq(aiReviewAnalysisEnrollments.id, enrollmentId))
    expect(firstPage?.enrolledRevisionCount).toBe(AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE)
    // A new adapter has no in-memory cursor from the first invocation.
    await expect(reconcile()).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: 3,
    })
    await expect(reconcile()).resolves.toEqual({ status: 'waiting_for_replay' })
    const events = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG))
    const replayed = events
      .map(({ payload }) => payload as { reviewId?: string; analysisSequence?: number })
      .filter((payload) => payload.reviewId !== undefined)
    expect(replayed).toHaveLength(AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE + 3)
    expect(new Set(replayed.map((payload) => payload.reviewId)).size).toBe(
      replayed.length,
    )
    expect(new Set(replayed.map((payload) => payload.analysisSequence)).size).toBe(
      replayed.length,
    )
    await db.insert(aiPropertyAggregateSettlements).values(
      replayed.map((payload) => {
        if (payload.reviewId === undefined || payload.analysisSequence === undefined) {
          throw new Error('Expected a replayed review sequence')
        }
        return {
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: payload.reviewId,
          sourceEpoch: 0,
          reviewAnalysisEpoch: 1,
          analysisSequence: payload.analysisSequence,
          settledAt: NOW,
        }
      }),
    )
    const caughtUp = {
      status: 'caught_up',
      eligibleRevisionCount: replayed.length,
      caughtUpAnalysisSequence: replayed.length,
    }
    await expect(reconcile()).resolves.toMatchObject(caughtUp)
    await expect(reconcile()).resolves.toMatchObject(caughtUp)
  })

  it('rolls a failed page back, then retries from the same durable cursor', async () => {
    const db = getDb()
    const failingPool = drizzle(replayPool)
    const transaction = failingPool.transaction.bind(failingPool)
    vi.spyOn(failingPool, 'transaction').mockImplementationOnce((work) =>
      transaction(async (tx) => {
        await work(tx)
        throw new Error('interrupted before commit')
      }),
    )
    const failed = createReviewAnalysisEnrollmentAdapter(failingPool, randomUUID)
    await expect(
      failed.reconcile({
        enrollmentId,
        organizationId: ORG,
        expectedFence: FENCE,
        correlationId: enrollmentId,
        occurredAt: NOW,
      }),
    ).rejects.toThrow('interrupted before commit')
    const [head] = await db
      .select()
      .from(aiReviewAnalysisEnrollments)
      .where(eq(aiReviewAnalysisEnrollments.id, enrollmentId))
    expect(head).toMatchObject({ state: 'queued', enrolledRevisionCount: 0 })
    await expect(reconcile()).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: 3,
    })
  })
  it('refreshes sources between pages without replaying the committed page', async () => {
    const db = getDb()
    await addReviews(AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE)
    await expect(reconcile()).resolves.toMatchObject({
      pinnedRevisionCount: AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE,
    })
    await db
      .update(reviews)
      .set({ sourceRevision: 2 })
      .where(and(eq(reviews.propertyId, PROPERTY), eq(reviews.analysisSequence, 0)))
    await expect(reconcile()).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: 3,
    })
    const events = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORG),
          eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'),
        ),
      )
    const payloads = events.map(({ payload }) => payload as { sourceRevision: number })
    expect(payloads.filter((payload) => payload.sourceRevision === 1)).toHaveLength(
      AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE,
    )
    expect(payloads.filter((payload) => payload.sourceRevision === 2)).toHaveLength(3)
  })

  it('requires fresh approval of a changed oversized snapshot before emitting any page', async () => {
    await addReviews(10_000)
    await expect(reconcile()).resolves.toEqual({
      status: 'awaiting_assisted_approval',
      eligibleRevisionCount: 10_003,
      safetyCeiling: 10_000,
    })
    const approve = (digest: string) =>
      adapter().approveAssistedReplay({
        enrollmentId,
        organizationId: ORG,
        expectedFence: FENCE,
        approvedByOperatorId: 'synthetic-operator',
        approvalEvidenceDigest: digest,
        correlationId: randomUUID(),
        occurredAt: NOW,
      })
    await expect(approve('a'.repeat(64))).resolves.toMatchObject({ status: 'approved' })
    await getDb()
      .update(reviews)
      .set({ sourceRevision: 2 })
      .where(eq(reviews.id, REVIEWS[0]))
    await expect(reconcile()).resolves.toMatchObject({
      status: 'awaiting_assisted_approval',
    })
    expect(
      await adapter().readCurrent({ organizationId: ORG, propertyId: PROPERTY }),
    ).toMatchObject({
      state: 'awaiting_assisted_approval',
      assistedApproval: null,
      enrolledRevisionCount: 0,
    })
    await expect(approve('b'.repeat(64))).resolves.toMatchObject({ status: 'approved' })
    await expect(reconcile()).resolves.toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: AI_REVIEW_ANALYSIS_REPLAY_PAGE_SIZE,
    })
  })

  it('persists inconsistent replay evidence as needing attention', async () => {
    const db = getDb()
    await reconcile()
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORG),
          eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'),
        ),
      )
      .limit(1)
    if (!event) throw new Error('Expected a replay event')
    await db.insert(outboxEvents).values({ ...event, id: randomUUID() })
    await expect(reconcile()).resolves.toEqual({
      status: 'stalled',
      reason: 'verification_inconsistent',
    })
    expect(
      await adapter().readCurrent({ organizationId: ORG, propertyId: PROPERTY }),
    ).toMatchObject({ state: 'stalled', terminalReason: 'verification_inconsistent' })
  })
})
