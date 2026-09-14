import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { aiReviewAnalysisBacklog, properties, reviews } from '#/shared/db/schema'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createAiReviewAnalysisBacklogAdapter } from './ai-review-analysis-backlog.adapter'

const NOW = Date.parse('2026-09-15T12:00:00.000Z')
const ORGANIZATION_ID = organizationId(`ai-backlog-${randomUUID()}`)
const PROPERTY_A = propertyId(randomUUID())
const PROPERTY_B = propertyId(randomUUID())
const DAY = 24 * 60 * 60 * 1_000

describe.sequential('AI review analysis backlog adapter (real PostgreSQL)', () => {
  const db = getDb()
  const backlog = createAiReviewAnalysisBacklogAdapter(db)
  let sequence = 0

  async function seedReview(property: typeof PROPERTY_A, reviewedDaysAgo: number) {
    sequence += 1
    const id = reviewId(randomUUID())
    await db.insert(reviews).values({
      id,
      organizationId: ORGANIZATION_ID,
      propertyId: property,
      platform: 'google',
      externalId: `ai-backlog-review-${id}`,
      reviewerName: 'Synthetic reviewer',
      rating: 5,
      text: 'Synthetic review',
      languageCode: 'en',
      reviewedAt: new Date(NOW - reviewedDaysAgo * DAY),
      contentExpiresAt: new Date(NOW + 30 * DAY),
      sourceEpoch: 1,
      sourceRevision: 1,
      analysisSequence: sequence,
    })
    return { id, sequence }
  }

  async function enqueue(
    property: typeof PROPERTY_A,
    review: Readonly<{ id: ReturnType<typeof reviewId>; sequence: number }>,
    nowEpochMillis = NOW,
  ) {
    const eventEnvelopeId = randomUUID()
    await backlog.enqueue({
      eventEnvelopeId,
      organizationId: ORGANIZATION_ID,
      propertyId: property,
      reviewId: review.id,
      sourceEpoch: 1,
      sourceRevision: 1,
      analysisSequence: review.sequence,
      origin: 'historical_onboarding',
      nowEpochMillis,
    })
    return eventEnvelopeId
  }

  beforeAll(async () => {
    const stale = await db.execute(sql`
      SELECT id FROM organization WHERE id LIKE 'ai-backlog-%'
    `)
    await deleteTestOrganizations(
      db,
      (stale.rows as unknown as ReadonlyArray<Readonly<{ id: string }>>).map(
        (row) => row.id,
      ),
    )
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI backlog test', ${ORGANIZATION_ID}, ${new Date(NOW)})
    `)
    await db.insert(properties).values(
      [PROPERTY_A, PROPERTY_B].map((id, index) => ({
        id,
        organizationId: ORGANIZATION_ID,
        name: `AI backlog property ${index}`,
        slug: `ai-backlog-${id.slice(0, 8)}`,
        timezone: 'Europe/Sofia',
        countryCode: 'BG',
        profileVersion: 1,
        sourceEpoch: 1,
      })),
    )
  })

  beforeEach(async () => {
    // Claiming is deliberately cross-tenant (one drainer serves every
    // property), so the whole table must start empty for each case.
    await db.delete(aiReviewAnalysisBacklog)
  })

  afterAll(async () => {
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  })

  it('claims the newest reviews first, at most the per-property share', async () => {
    const old = await seedReview(PROPERTY_A, 30)
    const newest = await seedReview(PROPERTY_A, 1)
    const middle = await seedReview(PROPERTY_A, 10)
    await enqueue(PROPERTY_A, old)
    const newestEnvelope = await enqueue(PROPERTY_A, newest)
    const middleEnvelope = await enqueue(PROPERTY_A, middle)

    const claimed = await backlog.claimReady({
      nowEpochMillis: NOW + 1,
      leaseMillis: 60_000,
      perProperty: 2,
      limit: 10,
    })

    expect(claimed.map((entry) => entry.eventEnvelopeId)).toEqual([
      newestEnvelope,
      middleEnvelope,
    ])
    expect(claimed[0]).toMatchObject({
      propertyId: PROPERTY_A,
      priority: 'background',
      origin: 'historical_onboarding',
      firstStartedAtEpochMillis: NOW + 1,
    })
    await expect(
      backlog.claimReady({
        nowEpochMillis: NOW + 2,
        leaseMillis: 60_000,
        perProperty: 2,
        limit: 10,
      }),
    ).resolves.toHaveLength(1)
  })

  it('gives every property with ready work a share', async () => {
    await enqueue(PROPERTY_A, await seedReview(PROPERTY_A, 1))
    await enqueue(PROPERTY_A, await seedReview(PROPERTY_A, 2))
    await enqueue(PROPERTY_B, await seedReview(PROPERTY_B, 50))

    const claimed = await backlog.claimReady({
      nowEpochMillis: NOW + 1,
      leaseMillis: 60_000,
      perProperty: 1,
      limit: 2,
    })

    expect(new Set(claimed.map((entry) => entry.propertyId))).toEqual(
      new Set([PROPERTY_A, PROPERTY_B]),
    )
  })

  it('re-offers an entry once its claim lease lapses or it is rescheduled', async () => {
    const envelope = await enqueue(PROPERTY_A, await seedReview(PROPERTY_A, 1))
    await backlog.claimReady({
      nowEpochMillis: NOW,
      leaseMillis: 60_000,
      perProperty: 3,
      limit: 3,
    })

    await expect(
      backlog.claimReady({
        nowEpochMillis: NOW + 59_999,
        leaseMillis: 60_000,
        perProperty: 3,
        limit: 3,
      }),
    ).resolves.toEqual([])
    const lapsed = await backlog.claimReady({
      nowEpochMillis: NOW + 60_000,
      leaseMillis: 60_000,
      perProperty: 3,
      limit: 3,
    })
    expect(lapsed.map((entry) => entry.eventEnvelopeId)).toEqual([envelope])
    expect(lapsed[0]?.firstStartedAtEpochMillis).toBe(NOW)

    await backlog.reschedule({
      eventEnvelopeId: envelope,
      organizationId: ORGANIZATION_ID,
      nextAttemptAtEpochMillis: NOW + 120_000,
      nowEpochMillis: NOW + 60_001,
    })
    await expect(
      backlog.claimReady({
        nowEpochMillis: NOW + 119_999,
        leaseMillis: 60_000,
        perProperty: 3,
        limit: 3,
      }),
    ).resolves.toEqual([])
    await expect(
      backlog.claimReady({
        nowEpochMillis: NOW + 120_000,
        leaseMillis: 60_000,
        perProperty: 3,
        limit: 3,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ eventEnvelopeId: envelope, attempts: 1 }),
    ])
  })

  it('enqueues idempotently by origin event and completes by deleting', async () => {
    const review = await seedReview(PROPERTY_A, 1)
    const envelope = await enqueue(PROPERTY_A, review)
    await backlog.enqueue({
      eventEnvelopeId: envelope,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_A,
      reviewId: review.id,
      sourceEpoch: 1,
      sourceRevision: 1,
      analysisSequence: review.sequence,
      origin: 'backfill',
      nowEpochMillis: NOW,
    })
    await expect(
      backlog.hasPendingForReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: review.id,
      }),
    ).resolves.toBe(true)

    await backlog.complete({ eventEnvelopeId: envelope, organizationId: ORGANIZATION_ID })

    await expect(
      backlog.hasPendingForReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: review.id,
      }),
    ).resolves.toBe(false)
  })

  it('claims one requested review as interactive ahead of the queue', async () => {
    const requested = await seedReview(PROPERTY_A, 40)
    await enqueue(PROPERTY_A, await seedReview(PROPERTY_A, 1))
    const requestedEnvelope = await enqueue(PROPERTY_A, requested)

    const claimed = await backlog.claimForReview({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_A,
      reviewId: requested.id,
      nowEpochMillis: NOW + 1,
      leaseMillis: 60_000,
    })
    expect(claimed).toMatchObject({
      eventEnvelopeId: requestedEnvelope,
      priority: 'interactive',
    })
    await expect(
      backlog.claimForReview({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_A,
        reviewId: requested.id,
        nowEpochMillis: NOW + 2,
        leaseMillis: 60_000,
      }),
    ).resolves.toBeNull()

    await backlog.reschedule({
      eventEnvelopeId: requestedEnvelope,
      organizationId: ORGANIZATION_ID,
      nextAttemptAtEpochMillis: NOW + 3,
      nowEpochMillis: NOW + 3,
    })
    const next = await backlog.claimReady({
      nowEpochMillis: NOW + 4,
      leaseMillis: 60_000,
      perProperty: 1,
      limit: 1,
    })
    expect(next.map((entry) => entry.eventEnvelopeId)).toEqual([requestedEnvelope])
  })

  it('counts queued and in-progress entries for a property', async () => {
    await enqueue(PROPERTY_A, await seedReview(PROPERTY_A, 1))
    await enqueue(PROPERTY_A, await seedReview(PROPERTY_A, 2))
    await enqueue(PROPERTY_B, await seedReview(PROPERTY_B, 3))
    await backlog.claimReady({
      nowEpochMillis: NOW,
      leaseMillis: 60_000,
      perProperty: 1,
      limit: 1,
    })

    const progressA = await backlog.readProgress({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_A,
      sourceEpoch: 1,
      reviewAnalysisEpoch: 1,
    })
    const progressB = await backlog.readProgress({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_B,
      sourceEpoch: 1,
      reviewAnalysisEpoch: 1,
    })

    expect(progressA.queued + progressA.inProgress).toBe(2)
    expect(progressB.queued + progressB.inProgress).toBe(1)
    expect(progressA.inProgress + progressB.inProgress).toBe(1)
    expect(progressA).toMatchObject({ analysed: 0, settled: 0 })
  })
})
