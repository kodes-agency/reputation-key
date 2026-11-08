import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, type Tx } from '#/shared/db'
import {
  aiPropertyAggregateContributions,
  aiPropertyAggregateSettlements,
  aiReviewAnalyses,
  properties,
} from '#/shared/db/schema'
import { organizationId, reviewId, userId } from '#/shared/domain/ids'
import { createV3Seed, mentionOf, seededReviewId } from '../testing/ai-v3-seed'
import { createPropertyProcessingProfileAdapter } from './property-processing-profile.adapter'
import { createAiGuestVoiceFactsAdapter } from './ai-guest-voice-facts.adapter'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'
import { createAiProfileRebuild } from './ai-profile-rebuild'

const db = getDb()
const IDS = {
  organizationId: 'ai-profile-rebuild-test',
  propertyId: '7b100000-0000-4000-8000-000000000001',
  idPrefix: '7b100000',
}
const seed = createV3Seed(db, IDS)
const profiles = () => createPropertyProcessingProfileAdapter(db, () => new Date())
const period = { startLocalDate: '2026-10-19', endLocalDate: '2026-10-21' }
const scope = (version: number) => ({ ...seed.scope, propertyProfileVersion: version })
async function facts(version: number) {
  return createAiGuestVoiceFactsAdapter(db).readFacts(scope(version), period)
}
async function rollover(timezone = 'Europe/Sofia') {
  await db.update(properties).set({ timezone }).where(eq(properties.id, IDS.propertyId))
  const result = await profiles().refreshForAi(seed.scope)
  expect(result.status).toBe('available')
  if (result.status !== 'available') throw new Error('Missing rolled profile')
  return result.profile.profileVersion
}

describe.sequential('processing profile rebuild through PostgreSQL', () => {
  beforeEach(async () => {
    await seed.setUp()
    for (const index of [1, 2, 3]) {
      await seed.addReview({
        index,
        rating: 2,
        reviewedAt: new Date('2026-10-20T01:00:00Z'),
        mentions: [
          mentionOf({
            topic: 'staff_service',
            polarity: 'negative',
            thing: 'service',
            issue: 'slow',
          }),
        ],
      })
    }
    await seed.addExcludedReview({
      index: 4,
      rating: 3,
      reviewedAt: new Date('2026-10-20T01:00:00Z'),
    })
    await seed.seal()
  })
  afterEach(() => seed.tearDown())

  it('keeps coverage updating, resumes committed batches after a restart, and converges without new settlements', async () => {
    expect((await facts(1))?.coverage.awaitingAnalysisCount).toBe(0)
    expect((await facts(1))?.reviews.every((row) => row.localDate === '2026-10-19')).toBe(
      true,
    )
    const version = await rollover()
    expect((await facts(version))?.coverage).toEqual({
      settledAnalysisCount: 0,
      expectedAnalysisCount: 4,
      awaitingAnalysisCount: 4,
    })
    await createAiProfileRebuild(db).rebuildProperty(scope(version), 1)
    expect((await facts(version))?.reviews).toHaveLength(1)
    expect((await facts(version))?.coverage.awaitingAnalysisCount).toBeGreaterThan(0)
    // A new instance has no process-local cursor to recover.
    await createAiProfileRebuild(db).sweep(1, 1)
    expect((await facts(version))?.reviews).toHaveLength(2)
    await createAiProfileRebuild(db).sweep(1, 1)
    const rebuilt = await facts(version)
    expect(rebuilt?.coverage).toEqual({
      settledAnalysisCount: 4,
      expectedAnalysisCount: 4,
      awaitingAnalysisCount: 0,
    })
    expect(rebuilt?.reviews).toHaveLength(3)
    expect(rebuilt?.reviews.map((row) => row.localDate)).toEqual([
      '2026-10-20',
      '2026-10-20',
      '2026-10-20',
    ])
    expect(rebuilt?.reviews.every((row) => row.mentions.length === 1)).toBe(true)
    await createAiProfileRebuild(db).sweep(1, 1)
    expect(await facts(version)).toEqual(rebuilt)
    const ledger = await db
      .select()
      .from(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, IDS.propertyId))
    expect(ledger).toHaveLength(4)
  })

  it('restores Inbox analysis reads and filters through the rebuilt projection while retaining paid provenance', async () => {
    const version = await rollover()
    const [analysis] = await db
      .select()
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.reviewId, seededReviewId(IDS, 1)))
    if (!analysis) throw new Error('Missing stored analysis')
    const outputs = createAiOutputStoreAdapter(db)
    const request = {
      ...scope(version),
      actorUserId: userId('ai-profile-rebuild-actor'),
      reviewId: reviewId(seededReviewId(IDS, 1)),
      sourceRevision: 1,
      analysisSequence: 1,
      authorizationLineageId: analysis.authorizationLineageId,
      analysisProfileVersion: 'review-analysis-v3',
      nowEpochMillis: new Date('2026-10-21T00:00:00Z').getTime(),
    }
    const read = () => outputs.readAnalysisForDelivery(request, async (result) => result)
    const filter = () =>
      outputs.findCurrentReviewIdsByAttention({
        organizationId: seed.scope.organizationId,
        propertyIds: [seed.scope.propertyId],
        attention: ['low'],
        nowEpochMillis: request.nowEpochMillis,
      })
    await expect(read()).resolves.toMatchObject({ status: 'none' })
    await expect(filter()).resolves.toEqual([])
    await createAiProfileRebuild(db).sweep()
    await expect(read()).resolves.toMatchObject({
      status: 'ready_v3',
      analysisProfileVersion: 'review-analysis-v3',
      mentions: [{ topic: 'staff_service', polarity: 'negative' }],
    })
    expect([...(await filter())].sort()).toEqual(
      [1, 2, 3].map((index) => seededReviewId(IDS, index)),
    )
    const [retained] = await db
      .select()
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.reviewId, seededReviewId(IDS, 1)))
    expect(retained).toEqual(analysis)
  })

  it('rolls back an interrupted transaction and retries the same pending rows', async () => {
    const version = await rollover()
    const interrupted = new Proxy(db, {
      get(target, key, receiver) {
        if (key === 'transaction') {
          return (run: (tx: Tx) => Promise<unknown>) =>
            db.transaction(async (tx) => {
              await run(tx)
              throw new Error('Simulated process interruption')
            })
        }
        return Reflect.get(target, key, receiver)
      },
    })
    await expect(
      createAiProfileRebuild(interrupted).rebuildProperty(scope(version), 1),
    ).rejects.toThrow('Simulated process interruption')
    expect((await facts(version))?.coverage.settledAnalysisCount).toBe(0)
    expect((await facts(version))?.reviews).toHaveLength(0)
    await createAiProfileRebuild(db).sweep()
    expect((await facts(version))?.coverage.awaitingAnalysisCount).toBe(0)
    expect((await facts(version))?.reviews).toHaveLength(3)
  })

  it('refuses another tenant or source epoch without changing rebuild progress', async () => {
    const version = await rollover()
    const before = await facts(version)
    await expect(
      createAiProfileRebuild(db).rebuildProperty({
        ...scope(version),
        organizationId: organizationId(IDS.organizationId + '-other'),
      }),
    ).resolves.toBe(false)
    await expect(
      createAiProfileRebuild(db).rebuildProperty({ ...scope(version), sourceEpoch: 1 }),
    ).resolves.toBe(false)
    expect(await facts(version)).toEqual(before)
  })

  it('does not resurrect a review withdrawn while its old profile is awaiting rebuilding', async () => {
    const version = await rollover()
    await seed.aggregates.advanceWithoutAnalysis({
      ...scope(version),
      reviewId: reviewId(seededReviewId(IDS, 1)),
      analysisSequence: 5,
      dispositionCode: 'provider_deleted',
    })
    await seed.seal(5)
    await createAiProfileRebuild(db).sweep()
    const rebuilt = await facts(version)
    expect(rebuilt?.coverage.awaitingAnalysisCount).toBe(0)
    expect(rebuilt?.reviews.map((row) => row.reviewId).sort()).toEqual([
      seededReviewId(IDS, 2),
      seededReviewId(IDS, 3),
    ])
    await expect(
      seed.aggregates.applyReviewAnalysis({
        ...scope(version),
        reviewId: reviewId(seededReviewId(IDS, 1)),
        sourceRevision: 1,
        analysisSequence: 1,
        calendarProfileVersion: 'property-calendar-v1',
      }),
    ).resolves.toEqual({ status: 'stale' })
    expect(await facts(version)).toEqual(rebuilt)
  })

  it('rebuilds only the latest settled analysis when an older result arrives again', async () => {
    await seed.reanalyze({
      index: 1,
      sequence: 5,
      rating: 2,
      reviewedAt: new Date('2026-10-20T01:00:00Z'),
      sentiment: 'positive',
      mentions: [mentionOf({ topic: 'staff_service', polarity: 'positive' })],
    })
    const version = await rollover()
    await createAiProfileRebuild(db).sweep()
    const rebuilt = await facts(version)
    expect(rebuilt?.coverage).toEqual({
      settledAnalysisCount: 5,
      expectedAnalysisCount: 5,
      awaitingAnalysisCount: 0,
    })
    const latest = rebuilt?.reviews.find((row) => row.reviewId === seededReviewId(IDS, 1))
    expect(latest).toMatchObject({
      analysisSequence: 5,
      mentions: [{ polarity: 'positive' }],
    })
    await seed.aggregates.applyReviewAnalysis({
      ...scope(version),
      reviewId: reviewId(seededReviewId(IDS, 1)),
      sourceRevision: 1,
      analysisSequence: 1,
      calendarProfileVersion: 'property-calendar-v1',
    })
    expect(await facts(version)).toEqual(rebuilt)
  })

  it('rotates a locked tenant so another tenant can converge on the next bounded tick', async () => {
    await rollover()
    const other = createV3Seed(db, {
      organizationId: IDS.organizationId + '-other',
      propertyId: '7b200000-0000-4000-8000-000000000001',
      idPrefix: '7b200000',
    })
    let release = () => {}
    let locked = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      locked = resolve
    })
    let holder: Promise<void> | undefined
    try {
      await other.setUp()
      await other.addReview({
        index: 1,
        rating: 5,
        reviewedAt: new Date('2026-10-20T01:00:00Z'),
      })
      await other.seal()
      await db
        .update(properties)
        .set({ timezone: 'Europe/Sofia' })
        .where(eq(properties.id, other.scope.propertyId))
      await profiles().refreshForAi(other.scope)
      holder = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM properties WHERE id = ${IDS.propertyId}::uuid FOR UPDATE`,
        )
        locked()
        await gate
      })
      await Promise.race([ready, holder])
      await createAiProfileRebuild(db).sweep(1, 1)
      expect((await facts(2))?.coverage.awaitingAnalysisCount).toBe(4)
      await createAiProfileRebuild(db).sweep(1, 1)
      const otherFacts = await createAiGuestVoiceFactsAdapter(db).readFacts(
        { ...other.scope, propertyProfileVersion: 2 },
        period,
      )
      expect(otherFacts?.coverage.awaitingAnalysisCount).toBe(0)
      expect(otherFacts?.reviews).toHaveLength(1)
    } finally {
      release()
      try {
        await holder
      } finally {
        await other.tearDown()
      }
    }
  })

  it('abandons an obsolete rebuild and resumes the newest profile after a second rollover', async () => {
    const first = await rollover()
    await createAiProfileRebuild(db).rebuildProperty(scope(first), 1)
    const latest = await rollover('Asia/Tokyo')
    await expect(
      createAiProfileRebuild(db).rebuildProperty(scope(first), 1),
    ).resolves.toBe(false)
    await createAiProfileRebuild(db).sweep()
    expect((await facts(latest))?.coverage.awaitingAnalysisCount).toBe(0)
    expect((await facts(latest))?.reviews).toHaveLength(3)
    const contributions = await db
      .select()
      .from(aiPropertyAggregateContributions)
      .where(
        and(
          eq(aiPropertyAggregateContributions.propertyId, IDS.propertyId),
          eq(aiPropertyAggregateContributions.propertyProfileVersion, latest),
        ),
      )
    expect(contributions).toHaveLength(3)
    const legacy = await db.execute<{ count: number }>(sql`SELECT (
      (SELECT count(*) FROM ai_property_daily_aggregates WHERE property_id = ${IDS.propertyId}::uuid) +
      (SELECT count(*) FROM ai_property_daily_aspect_aggregates WHERE property_id = ${IDS.propertyId}::uuid) +
      (SELECT count(*) FROM ai_property_aggregate_contribution_aspects WHERE property_id = ${IDS.propertyId}::uuid)
    )::int AS count`)
    expect(legacy.rows).toEqual([{ count: 0 }])
  })
})
