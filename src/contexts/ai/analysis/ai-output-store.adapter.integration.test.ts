import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiOperations,
  aiPropertyAggregateContributions,
  aiReviewAnalyses,
  merchantAiEnablement,
  outboxEvents,
  reviews,
} from '#/shared/db/schema'
import { userId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_CHANGES,
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { ASPECT_TAXONOMY_V1 } from '#/shared/analysis/aspect-taxonomy'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation/ai-operation-profiles'
import {
  ACTOR_USER_ID,
  ANALYSIS_EXPIRES_AT,
  COMPLETED_AT,
  LINEAGE_ID,
  OPERATION_ID,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_A_ID,
  SOURCE_EPOCH,
  SOURCE_REVISION,
  createReviewAnalysisStoreFixture,
} from './review-analysis-store.test-fixtures'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter.server'
import { createAggregateHelpers } from './property-aggregate.test-fixtures'

// The notice before the current one. Its consent stays valid at its own version
// (docs/BETA.md §2), so an operation claimed under it is a real state: the
// Property's AI work from before it re-consented.
const EARLIER_NOTICE_VERSION = 'merchant-ai-notice-2026-09-09.v1'
const EARLIER_NOTICE_DIGEST =
  'd80fe3b03f89697cde6c46810053248206aa3745b5f4a5522a24c1c2fdb438e1'

describe.sequential('AI output store analysis persistence (real PostgreSQL)', () => {
  const db = getDb()
  const outputs = createAiOutputStoreAdapter(db)
  const { apply } = createAggregateHelpers(db)
  const fixture = createReviewAnalysisStoreFixture(db)
  const { seedStoredReviewA } = fixture

  beforeAll(fixture.install)
  beforeEach(fixture.resetBetweenTests)
  afterEach(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  })
  afterAll(fixture.remove)

  const storeReviewA = () =>
    outputs.storeAnalysisV3({
      operationId: OPERATION_ID,
      providerCompletion: {
        expectedAttempt: 1,
        modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
        inputTokens: 20,
        outputTokens: 10,
        completedAtEpochMillis: COMPLETED_AT.getTime(),
      },
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_A_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 1,
      authorizationLineageId: LINEAGE_ID,
      reviewAnalysisEpoch: 1,
      propertyProfileVersion: 1,
      analysisProfileVersion: 'review-analysis-v3',
      derivative: {
        sentiment: 'positive',
        attention: 'low',
        urgentReason: null,
        mentions: [],
        normalization: { flags: [], droppedMentionCount: 0 },
      },
      generatedAtEpochMillis: COMPLETED_AT.getTime(),
      expiresAtEpochMillis: ANALYSIS_EXPIRES_AT.getTime(),
    })

  const readReviewA = (analysisProfileVersion = 'review-analysis-v2') =>
    outputs.readAnalysisForDelivery(
      {
        organizationId: ORGANIZATION_ID,
        actorUserId: userId(ACTOR_USER_ID),
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_A_ID,
        authorizationLineageId: LINEAGE_ID,
        reviewAnalysisEpoch: 1,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: 1,
        propertyProfileVersion: 1,
        analysisProfileVersion,
        nowEpochMillis: COMPLETED_AT.getTime(),
      },
      async (result) => result,
    )

  const setGrantNotice = async (noticeVersion: string, noticeDigest: string) => {
    await db.transaction(async (tx) => {
      // Isolate notice coverage from the epoch and lineage fences a transition also moves.
      await tx.execute(
        sql`ALTER TABLE merchant_ai_enablement DISABLE TRIGGER merchant_ai_enablement_transition_guard`,
      )
      await tx
        .update(merchantAiEnablement)
        .set({ noticeVersion, noticeDigest })
        .where(eq(merchantAiEnablement.propertyId, PROPERTY_ID))
      await tx.execute(
        sql`ALTER TABLE merchant_ai_enablement ENABLE TRIGGER merchant_ai_enablement_transition_guard`,
      )
    })
  }
  it('keeps a stored analysis readable under a lapsed notice until its grant changes', async () => {
    await seedStoredReviewA()
    try {
      await setGrantNotice(EARLIER_NOTICE_VERSION, EARLIER_NOTICE_DIGEST)
      await db
        .update(aiOperations)
        .set({
          noticeVersion: EARLIER_NOTICE_VERSION,
          noticeDigest: EARLIER_NOTICE_DIGEST,
        })
        .where(eq(aiOperations.id, OPERATION_ID))
      await expect(readReviewA()).resolves.toMatchObject({
        status: 'ready',
        sentiment: 'positive',
      })
    } finally {
      await setGrantNotice(MERCHANT_AI_NOTICE_VERSION, MERCHANT_AI_NOTICE_DIGEST)
    }
  })

  /** The operation as one claimed under another notice, and nothing else moved. */
  const claimUnderAnotherNotice = (
    notice: Readonly<{ noticeVersion?: string; noticeDigest?: string }>,
  ) => db.update(aiOperations).set(notice).where(eq(aiOperations.id, OPERATION_ID))

  // Notice drift withholds stored output (docs/BETA.md §2). In production a
  // re-consent also advances the capability epochs, and the epoch comparisons
  // beside these would refuse first. Here the lineage, the epochs and the state
  // version all stay where they were, so the notice comparison alone decides.
  // A newer notice that left Review Analysis unchanged is no drift for it
  // (ADR 0074): a drafting-only re-consent keeps the epochs, so only this
  // comparison could hide the history.
  describe('an operation claimed under another notice', () => {
    const DRIFTS = [
      ['version', { noticeVersion: EARLIER_NOTICE_VERSION }],
      ['digest', { noticeDigest: EARLIER_NOTICE_DIGEST }],
    ] as const

    it.each(DRIFTS)(
      'withholds its stored analysis (notice %s)',
      async (_field, notice) => {
        await seedStoredReviewA()
        // The control: under the notice the Property consented to, it is read.
        await expect(readReviewA()).resolves.toMatchObject({ status: 'ready' })

        await claimUnderAnotherNotice(notice)

        const withheld = await readReviewA()
        expect(withheld.status).toBe('none')
        expect(withheld).not.toHaveProperty('sentiment')
      },
    )

    it('keeps its stored analysis when the newer notice changed only drafting', async () => {
      const draftingOnly = MERCHANT_AI_NOTICE_CHANGES.find(
        (change) => change.noticeVersion === 'merchant-ai-notice-2026-11-01.v1',
      )
      expect(draftingOnly?.materiallyChanges).toEqual(['reply_drafting'])
      await seedStoredReviewA()

      try {
        await setGrantNotice(draftingOnly!.noticeVersion, draftingOnly!.noticeDigest)
        await claimUnderAnotherNotice(draftingOnly!.replaces!)

        await expect(readReviewA()).resolves.toMatchObject({
          status: 'ready',
          sentiment: 'positive',
        })
      } finally {
        await setGrantNotice(MERCHANT_AI_NOTICE_VERSION, MERCHANT_AI_NOTICE_DIGEST)
      }
    })

    it('withholds stored analysis and in-flight results across a notice that changed analysis', async () => {
      const analysisChange = MERCHANT_AI_NOTICE_CHANGES.find(
        (change) => change.noticeVersion === 'merchant-ai-notice-2026-11-06.v1',
      )
      expect(analysisChange?.materiallyChanges).toContain('review_analysis')
      await claimUnderAnotherNotice(analysisChange!.replaces!)
      await expect(storeReviewA()).resolves.toBe(false)
      await expect(
        db
          .select({ reviewId: aiReviewAnalyses.reviewId })
          .from(aiReviewAnalyses)
          .where(eq(aiReviewAnalyses.propertyId, PROPERTY_ID)),
      ).resolves.toEqual([])

      await seedStoredReviewA()
      const withheld = await readReviewA()
      expect(withheld.status).toBe('none')
      expect(withheld).not.toHaveProperty('sentiment')
    })

    it.each(DRIFTS)('stores nothing for it (notice %s)', async (_field, notice) => {
      await claimUnderAnotherNotice(notice)

      await expect(storeReviewA()).resolves.toBe(false)

      const stored = await db
        .select({ reviewId: aiReviewAnalyses.reviewId })
        .from(aiReviewAnalyses)
        .where(eq(aiReviewAnalyses.propertyId, PROPERTY_ID))
      expect(stored).toEqual([])
    })
  })

  it('stores a paid analysis when another review owns the property head sequence', async () => {
    await expect(storeReviewA()).resolves.toBe(true)

    const [analysis] = await db
      .select({
        reviewId: aiReviewAnalyses.reviewId,
        analysisSequence: aiReviewAnalyses.analysisSequence,
        status: aiReviewAnalyses.status,
        sentiment: aiReviewAnalyses.sentiment,
        primaryCategory: aiReviewAnalyses.primaryCategory,
        attention: aiReviewAnalyses.attention,
        issueLabel: aiReviewAnalyses.issueLabel,
      })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.operationId, OPERATION_ID))
    expect(analysis).toEqual({
      reviewId: REVIEW_A_ID,
      analysisSequence: 1,
      status: 'ready',
      sentiment: 'positive',
      primaryCategory: null,
      attention: 'low',
      issueLabel: null,
    })
    const [operation] = await db
      .select({ state: aiOperations.state, updatedAt: aiOperations.updatedAt })
      .from(aiOperations)
      .where(eq(aiOperations.id, OPERATION_ID))
    expect(operation).toEqual({
      state: 'succeeded_pending_delivery',
      updatedAt: COMPLETED_AT,
    })
  })

  it('reads current v1 analysis evidence with no aspect children', async () => {
    await seedStoredReviewA()
    await db
      .update(aiReviewAnalyses)
      .set({ analysisProfileVersion: 'review-analysis-v1' })
      .where(eq(aiReviewAnalyses.reviewId, REVIEW_A_ID))

    await expect(readReviewA('review-analysis-v1')).resolves.toMatchObject({
      status: 'ready',
      analysisProfileVersion: 'review-analysis-v1',
      aspects: [],
    })
  })

  it('still delivers and aggregates a stored ready v2 result, without its retired aspect rows', async () => {
    await seedStoredReviewA()
    await expect(readReviewA()).resolves.toMatchObject({
      status: 'ready',
      sentiment: 'positive',
      primaryCategory: ASPECT_TAXONOMY_V1[0],
      attention: 'low',
      aspects: [],
    })
    await expect(apply(REVIEW_A_ID, 1)).resolves.toEqual({
      status: 'applied',
      aggregateRevision: 1,
    })
    expect(
      await db
        .select()
        .from(aiPropertyAggregateContributions)
        .where(eq(aiPropertyAggregateContributions.reviewId, REVIEW_A_ID)),
    ).toHaveLength(1)
  })

  it('rejects an analysis after the review is pinned to a newer sequence', async () => {
    const allocated = await db.execute(sql`
      SELECT lock_review_ai_analysis_head_v1(
        ${ORGANIZATION_ID},
        ${PROPERTY_ID}::uuid,
        ${SOURCE_EPOCH}
      ) AS sequence
    `)
    expect(Number(allocated.rows[0]?.sequence)).toBe(3)
    await db
      .update(reviews)
      .set({ analysisSequence: 3 })
      .where(eq(reviews.id, REVIEW_A_ID))

    await expect(storeReviewA()).resolves.toBe(false)
    const analyses = await db
      .select({ operationId: aiReviewAnalyses.operationId })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.operationId, OPERATION_ID))
    expect(analyses).toEqual([])
  })
})
