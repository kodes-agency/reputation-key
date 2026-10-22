// `pnpm ops ai release-orphan-sequences` against real PostgreSQL. One Property
// holds every kind of sequence the scan has to tell apart:
//
//   1  nobody: no settlement, no Review, no event, not released   -> orphan
//   2  held by a Review that has not been analysed yet            -> not an orphan
//   3  announced by an outbox fact that has not been consumed      -> not an orphan
//   4  settled                                                     -> not an orphan
//   5  released already                                            -> not an orphan
//   6  nobody                                                      -> orphan
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyAggregateSettlements,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviewAiAnalysisReleasedSequences,
  reviews,
} from '#/shared/db/schema'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  ORPHAN_QUIET_PERIOD_MINUTES,
  releaseOrphanSequences,
  scanOrphanSequences,
} from './review-analysis-orphan-sequences'
import { readReleasedAwaitingSequenceCount } from './review-analysis-released-sequences'

const ORG = 'orphan-sequences-test'
const PROPERTY = '5eed0100-0000-4000-8000-000000000001'
const RECENT_PROPERTY = '5eed0100-0000-4000-8000-000000000002'
const NOT_ENABLED_PROPERTY = '5eed0100-0000-4000-8000-000000000003'
const HOLDING_REVIEW = '5eed0200-0000-4000-8000-000000000001'
const SETTLED_REVIEW = '5eed0200-0000-4000-8000-000000000002'
const AT = new Date('2026-09-10T12:00:00.000Z')
const MINUTE_MS = 60_000
const HEAD = 6

const db = getDb()

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * MINUTE_MS)

async function seedProperty(id: string, index: number, headUpdatedAt: Date) {
  await db.insert(properties).values({
    id,
    organizationId: ORG,
    name: `Orphan sequences property ${index}`,
    slug: `orphan-sequences-property-${index}`,
    timezone: 'UTC',
    countryCode: 'BG',
    profileVersion: 1,
    sourceEpoch: 0,
  })
  await db.insert(reviewAiAnalysisHeads).values({
    organizationId: ORG,
    propertyId: id,
    sourceEpoch: 0,
    headSequence: HEAD,
    createdAt: headUpdatedAt,
    updatedAt: headUpdatedAt,
  })
}

async function clearFixture(): Promise<void> {
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORG))
  await db.delete(properties).where(eq(properties.organizationId, ORG))
  await deleteTestOrganizations(db, [ORG])
}

const review = (id: string, propertyId: string, analysisSequence: number) => ({
  id,
  organizationId: ORG,
  propertyId,
  platform: 'google' as const,
  externalId: `orphan-sequences-${id}`,
  reviewerName: 'Synthetic reviewer',
  rating: 5,
  text: 'Synthetic review',
  languageCode: 'en',
  reviewedAt: AT,
  contentExpiresAt: new Date('2027-09-10T12:00:00.000Z'),
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence,
  aiSourceByteLength: 16,
  aiSourceDigest: 'a'.repeat(64),
})

describe.sequential('releasing orphan analysis sequences (PostgreSQL)', () => {
  beforeAll(async () => {
    await clearFixture()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORG}, 'Orphan sequences test', ${ORG}, now())
    `)
    await seedProperty(PROPERTY, 1, minutesAgo(ORPHAN_QUIET_PERIOD_MINUTES + 5))
    await seedProperty(RECENT_PROPERTY, 2, minutesAgo(ORPHAN_QUIET_PERIOD_MINUTES - 5))
    await db.insert(properties).values({
      id: NOT_ENABLED_PROPERTY,
      organizationId: ORG,
      name: 'Orphan sequences property 3',
      slug: 'orphan-sequences-property-3',
      timezone: 'UTC',
      countryCode: 'BG',
      profileVersion: 1,
      sourceEpoch: 0,
    })
    for (const [index, id] of [PROPERTY, RECENT_PROPERTY].entries()) {
      await seedEnabledReviewAnalysis(db, {
        organizationId: ORG,
        propertyId: id,
        authorizationLineageId: `5eed0300-0000-4000-8000-00000000000${index + 1}`,
        analysisStartSequence: 0,
        occurredAt: AT,
      })
    }
    await db.insert(reviews).values([
      review(HOLDING_REVIEW, PROPERTY, 2),
      // Its newest sequence is far above the head; sequence 4 settled earlier.
      review(SETTLED_REVIEW, PROPERTY, 40),
    ])
    await db.insert(outboxEvents).values({
      id: '5eed0400-0000-4000-8000-000000000001',
      eventType: 'review.updated',
      eventVersion: 1,
      payload: {
        reviewId: '5eed0200-0000-4000-8000-000000000009',
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 3,
      },
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceContext: 'review',
      sourceAggregateId: '5eed0200-0000-4000-8000-000000000009',
      createdAt: AT,
    })
    await db.insert(aiPropertyAggregateSettlements).values({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: SETTLED_REVIEW,
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      analysisSequence: 4,
      settledAt: AT,
    })
    await db.insert(reviewAiAnalysisReleasedSequences).values({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      analysisSequence: 5,
      reason: 'replayed_observation',
    })
  })

  afterAll(clearFixture)

  const releasedSequences = async (): Promise<readonly number[]> => {
    const rows = await db
      .select({ sequence: reviewAiAnalysisReleasedSequences.analysisSequence })
      .from(reviewAiAnalysisReleasedSequences)
      .where(eq(reviewAiAnalysisReleasedSequences.propertyId, PROPERTY))
    return rows.map((row) => row.sequence).sort((a, b) => a - b)
  }

  it('lists only the sequences nothing holds, announces, settles or released', async () => {
    const scan = await scanOrphanSequences(db, PROPERTY)

    expect(scan).toMatchObject({
      status: 'scanned',
      analysisStartSequence: 0,
      headSequence: HEAD,
      orphans: [1, 6],
      breakdown: { settled: 1, held: 1, announced: 1, released: 1, orphaned: 2 },
    })
    expect(await releasedSequences()).toEqual([5])
  })

  it('writes nothing while it only reports', async () => {
    await scanOrphanSequences(db, PROPERTY)

    expect(await releasedSequences()).toEqual([5])
  })

  it('refuses while the head moved within the quiet period', async () => {
    const scan = await scanOrphanSequences(db, RECENT_PROPERTY)
    const release = await releaseOrphanSequences(db, RECENT_PROPERTY)

    expect(scan).toMatchObject({ status: 'head_recently_updated' })
    expect(release).toMatchObject({ status: 'head_recently_updated' })
    const rows = await db
      .select()
      .from(reviewAiAnalysisReleasedSequences)
      .where(eq(reviewAiAnalysisReleasedSequences.propertyId, RECENT_PROPERTY))
    expect(rows).toEqual([])
  })

  it('refuses a Property without an enabled Review Analysis authorization', async () => {
    await expect(scanOrphanSequences(db, NOT_ENABLED_PROPERTY)).resolves.toEqual({
      status: 'not_enabled',
    })
  })

  it('refuses an unknown Property', async () => {
    await expect(
      scanOrphanSequences(db, '5eed0100-0000-4000-8000-0000000000ff'),
    ).resolves.toEqual({ status: 'property_not_found' })
  })

  it('records the orphans as operator repairs and leaves the others alone', async () => {
    const result = await releaseOrphanSequences(db, PROPERTY)

    expect(result).toMatchObject({ status: 'released', recorded: 2 })
    expect(await releasedSequences()).toEqual([1, 5, 6])
    const reasons = await db
      .select({
        sequence: reviewAiAnalysisReleasedSequences.analysisSequence,
        reason: reviewAiAnalysisReleasedSequences.reason,
      })
      .from(reviewAiAnalysisReleasedSequences)
      .where(eq(reviewAiAnalysisReleasedSequences.propertyId, PROPERTY))
    expect(
      reasons.sort((a, b) => a.sequence - b.sequence).map((row) => row.reason),
    ).toEqual(['operator_repair', 'replayed_observation', 'operator_repair'])
  })

  it('is a no-op the second time', async () => {
    const result = await releaseOrphanSequences(db, PROPERTY)

    expect(result).toMatchObject({ status: 'released', recorded: 0 })
    expect(result.status === 'released' ? result.scan.orphans : null).toEqual([])
    expect(await releasedSequences()).toEqual([1, 5, 6])
  })

  it('leaves coverage waiting only for the sequences that are really in flight', async () => {
    const released = await readReleasedAwaitingSequenceCount(db, {
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      startSequence: 0,
      headSequence: HEAD,
    })

    // 6 owed - 3 released = 3: sequences 2 and 3 (in flight) and 4 (settled).
    expect(released).toBe(3)
  })
})
