// What turning review analysis off takes with it (PostgreSQL). The merchant notice of
// 2026-10-30 tells the owner that turning a capability off and erasure "cover everything
// listed under 'What review analysis keeps'": the analyses and their mentions, the
// sentence numbers, the manager corrections beside them, the per-Property issue groups
// and the daily counts of reviews by star rating. Until the switch-on the lifecycle
// consumer deleted the analyses and the aggregates over them and left the other two
// (they waited for the 24-month sweep), so the sentence was untrue for them.
//
// The Property stays; a re-consent that keeps review analysis (a new epoch) keeps the
// groups and the star counts too, on purpose: a group is stable across a re-analysis so
// a manager's rename, merge or hide survives it, and a day's count follows the reviews,
// not an analysis. Every row is invented; no guest's words exist here.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyReviewPopulationDaily,
  aiReviewAnalysisMentionCorrections,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
} from '#/shared/db/schema'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { createReviewAnalysisEnrollmentAdapter } from './ai-review-analysis-enrollment.adapter'
import {
  createV3Seed,
  mentionOf,
  seededReviewId,
  type SeededReview,
} from '../testing/ai-v3-seed'

const IDS = {
  organizationId: 'ai-v3-turn-off-test-org',
  propertyId: '78000000-0000-4000-8000-000000000001',
  idPrefix: '78000000',
} as const
// The lineage the seed's grant is under (ai-v3-seed.ts lineageId).
const LINEAGE_ID = '78000000-0002-4000-8000-000000000001'
const NOW = new Date('2026-10-30T10:00:00.000Z')
const NOON = (month: number, day: number) =>
  new Date(Date.UTC(2026, month - 1, day, 16, 0, 0))

const db = getDb()
const seed = createV3Seed(db, IDS)
const enrollments = createReviewAnalysisEnrollmentAdapter(db, () => randomUUID())

const AIR_CONDITIONING = {
  topic: 'facilities_equipment',
  polarity: 'negative',
  thing: 'air conditioning',
  issue: 'not working',
  sentences: [2],
} as const

const REVIEWS: readonly SeededReview[] = [1, 2, 3].map((index): SeededReview => ({
  index,
  rating: 2,
  reviewedAt: NOON(10, 8 + index),
  sentiment: 'negative',
  attention: 'high',
  mentions: [mentionOf(AIR_CONDITIONING)],
}))

/** The v3 rows of the Property, by table, and the two it keeps beside its analyses. */
async function counts() {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM ai_review_analyses
        WHERE property_id = ${IDS.propertyId}::uuid) AS analyses,
      (SELECT count(*)::int FROM ai_review_analysis_mentions
        WHERE property_id = ${IDS.propertyId}::uuid) AS mentions,
      (SELECT count(*)::int FROM ai_review_analysis_mention_sentences
        WHERE property_id = ${IDS.propertyId}::uuid) AS sentences,
      (SELECT count(*)::int FROM ai_review_analysis_mention_corrections
        WHERE property_id = ${IDS.propertyId}::uuid) AS corrections,
      (SELECT count(*)::int FROM ai_property_aggregate_contributions
        WHERE property_id = ${IDS.propertyId}::uuid) AS contributions,
      (SELECT count(*)::int FROM ai_property_aggregate_contribution_mentions
        WHERE property_id = ${IDS.propertyId}::uuid) AS contribution_mentions,
      (SELECT count(*)::int FROM ai_property_issue_groups
        WHERE property_id = ${IDS.propertyId}::uuid) AS issue_groups,
      (SELECT count(*)::int FROM ai_property_issue_members
        WHERE property_id = ${IDS.propertyId}::uuid) AS issue_members,
      (SELECT count(*)::int FROM ai_property_review_population_daily
        WHERE property_id = ${IDS.propertyId}::uuid) AS star_counts,
      (SELECT count(*)::int FROM properties
        WHERE id = ${IDS.propertyId}::uuid) AS properties
  `)
  return result.rows[0] as Record<string, number>
}

const EVERYTHING_THE_NOTICE_LISTS = {
  analyses: 0,
  mentions: 0,
  sentences: 0,
  corrections: 0,
  contributions: 0,
  contribution_mentions: 0,
  issue_groups: 0,
  issue_members: 0,
  star_counts: 0,
} as const

type Posture = Readonly<{
  state: 'enabled' | 'revoked'
  capabilities: readonly ('review_analysis' | 'reply_drafting')[]
  reviewAnalysisEpoch: number
}>

/** Moves the Property's grant to its next state, as the identity store would write it. */
async function grantMoves(posture: Posture): Promise<number> {
  const stateVersion = 2
  const runtime: Record<string, string> = {}
  for (const capability of posture.capabilities) {
    runtime[capability] =
      capability === 'review_analysis'
        ? 'review-analysis-runtime-v2'
        : 'reply-drafting-runtime-v1'
  }
  const capabilities: string[] = [...posture.capabilities]
  const contract = {
    capabilities,
    capabilityRuntimeProfileVersions: runtime,
    reviewAnalysisEpoch: posture.reviewAnalysisEpoch,
    replyDraftingEpoch: 2,
    propertyTrendsEpoch: 2,
    authorizedSourceEpoch: 0,
    analysisStartSequence: 0,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    processingRegion: 'global',
    providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
    redactionProfileFamily: 'gbp-review-global-v1',
  } as const
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      organizationId: IDS.organizationId,
      propertyId: IDS.propertyId,
      authorizationLineageId: LINEAGE_ID,
      stateVersion,
      transitionKind: posture.state === 'revoked' ? 'revoke' : 'change',
      state: posture.state,
      ...contract,
      actorUserId: 'ai-v3-turn-off-actor',
      reasonCode:
        posture.state === 'revoked' ? 'merchant_revoked' : 'capabilities_changed',
      idempotencyKey: `ai-v3-turn-off-${posture.state}-${randomUUID()}`,
      requestHash: 'd'.repeat(64),
      occurredAt: NOW,
    })
    await tx
      .update(merchantAiEnablement)
      .set({
        state: posture.state,
        stateVersion,
        ...contract,
        updatedBy: 'ai-v3-turn-off-actor',
        updatedAt: NOW,
      })
      .where(
        and(
          eq(merchantAiEnablement.organizationId, IDS.organizationId),
          eq(merchantAiEnablement.propertyId, IDS.propertyId),
        ),
      )
  })
  return stateVersion
}

/** What the lifecycle consumer is told when the grant moved: the fence of the new state. */
async function consumerRuns(posture: Posture, stateVersion: number) {
  const eventEnvelopeId = randomUUID()
  await db.insert(outboxEvents).values({
    id: eventEnvelopeId,
    eventType: 'identity.merchant_ai.changed',
    eventVersion: 1,
    payload: { state: posture.state },
    organizationId: IDS.organizationId,
    propertyId: IDS.propertyId,
    sourceContext: 'identity',
    sourceAggregateId: IDS.propertyId,
    createdAt: NOW,
  })
  return enrollments.applyAuthorizationLifecycle({
    eventEnvelopeId,
    organizationId: IDS.organizationId as never,
    propertyId: IDS.propertyId as never,
    authorizationState: posture.state,
    fence: {
      authorizationLineageId: LINEAGE_ID,
      authorizationStateVersion: stateVersion,
      sourceEpoch: 0,
      reviewAnalysisEpoch: posture.reviewAnalysisEpoch,
      replyDraftingEpoch: 2,
      propertyTrendsEpoch: 2,
      analysisStartSequence: 0,
    },
    correlationId: null,
    occurredAt: NOW,
  })
}

describe('turning review analysis off (real PostgreSQL)', () => {
  beforeEach(async () => {
    await clearUp()
    clearEventSchemas()
    registerAllEventSchemas()
    await seed.setUp()
    for (const review of REVIEWS) await seed.addReview(review)
    await seed.seal()
    // The daily counts of reviews by star rating, one row per day, as the projection
    // writes them (no review identity in them).
    await db.insert(aiPropertyReviewPopulationDaily).values(
      [9, 10, 11].map((day) => ({
        organizationId: IDS.organizationId,
        propertyId: IDS.propertyId,
        localDate: `2026-10-${String(day).padStart(2, '0')}`,
        sourceEpoch: 0,
        propertyProfileVersion: 1,
        calendarProfileVersion: 'property-calendar-v1',
        reviewCount: 3,
        textReviewCount: 3,
        rating1Count: 0,
        rating2Count: 3,
        rating3Count: 0,
        rating4Count: 0,
        rating5Count: 0,
        populationRevision: 1,
        updatedAt: NOW,
      })),
    )
    // A manager's correction beside the first review's first mention.
    await db.insert(aiReviewAnalysisMentionCorrections).values({
      organizationId: IDS.organizationId,
      propertyId: IDS.propertyId,
      reviewId: seededReviewId(IDS, 1),
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      mentionOrdinal: 0,
      topic: AIR_CONDITIONING.topic,
      kind: 'remove_topic',
      correctedBy: 'ai-v3-turn-off-manager',
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  async function clearUp() {
    await db.execute(sql`
      DELETE FROM event_consumer_receipts
      WHERE event_id IN (
        SELECT id FROM outbox_events WHERE organization_id = ${IDS.organizationId}
      )
    `)
    await db
      .delete(outboxEvents)
      .where(eq(outboxEvents.organizationId, IDS.organizationId))
    await db
      .delete(aiPropertyReviewPopulationDaily)
      .where(eq(aiPropertyReviewPopulationDaily.organizationId, IDS.organizationId))
    await seed.tearDown()
  }

  afterAll(async () => {
    await clearUp()
    clearEventSchemas()
  })

  it('starts with every kind of row the notice lists, so the deletions below are not vacuous', async () => {
    const before = await counts()

    expect(before).toMatchObject({
      analyses: 3,
      mentions: 3,
      corrections: 1,
      contributions: 3,
      contribution_mentions: 3,
      star_counts: 3,
      properties: 1,
    })
    expect(before.sentences).toBeGreaterThan(0)
    expect(before.issue_groups).toBeGreaterThan(0)
    expect(before.issue_members).toBeGreaterThan(0)
  })

  it('deletes the analyses, mentions, corrections, issue groups and daily star counts when the grant is revoked', async () => {
    const posture: Posture = {
      state: 'revoked',
      capabilities: [],
      reviewAnalysisEpoch: 2,
    }
    const stateVersion = await grantMoves(posture)

    const result = await consumerRuns(posture, stateVersion)

    expect(result).toMatchObject({ status: 'applied' })
    expect(await counts()).toEqual({ ...EVERYTHING_THE_NOTICE_LISTS, properties: 1 })
  })

  it('deletes them as well when only review analysis is taken off the grant', async () => {
    const posture: Posture = {
      state: 'enabled',
      capabilities: ['reply_drafting'],
      reviewAnalysisEpoch: 2,
    }
    const stateVersion = await grantMoves(posture)

    const result = await consumerRuns(posture, stateVersion)

    expect(result).toMatchObject({ status: 'applied' })
    expect(await counts()).toEqual({ ...EVERYTHING_THE_NOTICE_LISTS, properties: 1 })
  })

  it('keeps the issue groups and the star counts when review analysis stays on and only the epoch moves', async () => {
    const posture: Posture = {
      state: 'enabled',
      capabilities: ['review_analysis'],
      reviewAnalysisEpoch: 2,
    }
    const before = await counts()
    const stateVersion = await grantMoves(posture)

    const result = await consumerRuns(posture, stateVersion)

    expect(result).toMatchObject({ status: 'applied' })
    const after = await counts()
    // The analyses of the retired epoch go, and the rows over them with them; what is
    // stable across a re-analysis stays, so a rename or a hide a manager made survives it.
    expect(after).toMatchObject({
      analyses: 0,
      mentions: 0,
      corrections: 0,
      contributions: 0,
      contribution_mentions: 0,
    })
    expect(after.issue_groups).toBe(before.issue_groups)
    expect(after.issue_members).toBe(before.issue_members)
    expect(after.star_counts).toBe(before.star_counts)
  })
})
