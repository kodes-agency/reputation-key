import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  aiPropertyAggregateHeads,
  aiPropertyAggregateSettlements,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  createAnalyzeReviewEvent,
  settleReviewAnalysisWithoutResult,
  type AnalyzeReviewEventDependencies,
} from '../application/use-cases/analyze-review-event'
import { createAiAuthorizationAdapter } from './adapters/ai-authorization.adapter'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'
import { createAiReviewEventStoreAdapter } from './adapters/ai-review-event-store.adapter'
import { AI_REVIEW_ANALYSIS_CONSUMER, handleAiReviewEvent } from './outbox-consumers'

const NOW = new Date('2026-09-11T10:00:00.000Z')
const IMPORTED_REVIEWS = 3
const ORGANIZATION_ID = organizationId('ai-first-enable-lineage-test')
const PROPERTY_ID = propertyId('77000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '77000000-0000-4000-8000-000000000002'
const REVIEW_IDS = Object.freeze(
  Array.from({ length: IMPORTED_REVIEWS + 1 }, (_, index) =>
    reviewId(`77100000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  ),
)
const EVENT_IDS = Object.freeze(
  Array.from(
    { length: IMPORTED_REVIEWS },
    (_, index) => `77200000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ),
)

const db = getDb()
const receipts = createOutboxRepository(db)
const reviewEvents = createAiReviewEventStoreAdapter(db)
const aggregates = createAiPropertyAggregateStoreAdapter(db)

function unreachable(name: string) {
  return async () => {
    throw new Error(`${name} must not be reached before the property has a lineage`)
  }
}

// Every dependency past authorization throws: a lineage-less event must be
// acknowledged by the authorization read alone.
const analyzeReviewEvent = createAnalyzeReviewEvent({
  authorization: createAiAuthorizationAdapter(db),
  reviewEvents: {
    consumeNext: unreachable('reviewEvents.consumeNext'),
    settleOutcome: unreachable('reviewEvents.settleOutcome'),
  },
  aggregates: {
    applyReviewAnalysis: unreachable('aggregates.applyReviewAnalysis'),
    advanceWithoutAnalysis: unreachable('aggregates.advanceWithoutAnalysis'),
    readWindow: unreachable('aggregates.readWindow'),
  },
  processingProfiles: {
    readForAi: unreachable('processingProfiles.readForAi'),
    refreshForAi: unreachable('processingProfiles.refreshForAi'),
  },
  nowEpochMillis: () => NOW.getTime(),
} as unknown as AnalyzeReviewEventDependencies)

function reviewCreated(sequence: number): ConsumerEvent {
  const eventId = EVENT_IDS[sequence - 1]
  const id = REVIEW_IDS[sequence - 1]
  if (!eventId || !id) throw new Error(`No fixture event for sequence ${sequence}`)
  return {
    eventId,
    eventType: 'review.created',
    eventVersion: 1,
    payload: {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: id,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: sequence,
      occurredAt: NOW.toISOString(),
    },
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceContext: 'review',
    sourceAggregateId: id,
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString(),
  }
}

async function lineageDerivatives() {
  const [ledger, heads, receipted] = await Promise.all([
    db
      .select({ sequence: aiPropertyAggregateSettlements.analysisSequence })
      .from(aiPropertyAggregateSettlements)
      .where(eq(aiPropertyAggregateSettlements.propertyId, PROPERTY_ID)),
    db
      .select({ settled: aiPropertyAggregateHeads.settledAnalysisCount })
      .from(aiPropertyAggregateHeads)
      .where(eq(aiPropertyAggregateHeads.propertyId, PROPERTY_ID)),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM event_consumer_receipts
      WHERE consumer_name = ${AI_REVIEW_ANALYSIS_CONSUMER}
        AND status = 'applied'
        AND event_id IN (
          SELECT id FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}
        )
    `),
  ])
  return {
    ledgerSequences: ledger.map((row) => row.sequence).sort((a, b) => a - b),
    heads: heads.map((row) => row.settled),
    receipted: receipted.rows[0]?.count ?? -1,
  }
}

// Mirrors what `apply_merchant_ai_transition_v1` writes for a first enable:
// epoch 1 and the watermark at the allocator head, so every sequence allocated
// before the enable sits at or below it.
async function enableAtCurrentHead(): Promise<void> {
  const [head] = await db
    .select({ headSequence: reviewAiAnalysisHeads.headSequence })
    .from(reviewAiAnalysisHeads)
    .where(eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID))
  if (!head) throw new Error('Allocator head fixture is missing')
  const capabilities = ['review_analysis', 'reply_drafting', 'property_trends'] as const
  const runtimeProfiles = {
    review_analysis: 'review-analysis-runtime-v1',
    reply_drafting: 'reply-drafting-runtime-v1',
    property_trends: 'property-trends-runtime-v1',
  }
  const lineage = {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    authorizationLineageId: LINEAGE_ID,
    state: 'enabled' as const,
    capabilities: [...capabilities],
    capabilityRuntimeProfileVersions: runtimeProfiles,
    reviewAnalysisEpoch: 1,
    replyDraftingEpoch: 1,
    propertyTrendsEpoch: 1,
    authorizedSourceEpoch: 0,
    analysisStartSequence: head.headSequence,
    stateVersion: 1,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    routingPolicyVersion: 1,
    processingRegion: 'global' as const,
    providerDeploymentProfileVersion: 'private-beta-global-v1' as const,
    redactionProfileFamily: 'gbp-review-global-v1',
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
    await tx.insert(merchantAiConsentEvidence).values({
      ...lineage,
      transitionKind: 'enable',
      actorUserId: 'ai-first-enable-test-actor',
      reasonCode: 'merchant_enabled',
      idempotencyKey: 'ai-first-enable-v1',
      requestHash: 'd'.repeat(64),
      occurredAt: NOW,
    })
    await tx.insert(merchantAiEnablement).values({
      ...lineage,
      updatedBy: 'ai-first-enable-test-actor',
      updatedAt: NOW,
    })
  })
}

function windowRequest() {
  return {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    sourceEpoch: 0,
    reviewAnalysisEpoch: 1,
    propertyProfileVersion: 1,
    startLocalDate: '2026-09-01',
    endLocalDate: '2026-09-11',
    calendarProfileVersion: 'property-calendar-v1' as const,
  }
}

async function clearFixture(): Promise<void> {
  await db.execute(sql`
    DELETE FROM event_consumer_receipts AS receipt
    USING outbox_events AS event
    WHERE receipt.event_id = event.id
      AND event.organization_id = ${ORGANIZATION_ID}
  `)
  await db.delete(outboxEvents).where(eq(outboxEvents.organizationId, ORGANIZATION_ID))
  await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
  await deleteTestOrganizations(db, [ORGANIZATION_ID])
}

describe.sequential('Review Analysis first-enable lineage (real PostgreSQL)', () => {
  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clearFixture()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI first-enable test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI first-enable test property',
      slug: 'ai-first-enable-test-property',
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
      profileVersion: 1,
      sourceEpoch: 0,
    })
    await db.insert(reviews).values(
      REVIEW_IDS.slice(0, IMPORTED_REVIEWS).map((id, index) => ({
        id,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google' as const,
        externalId: `ai-first-enable-review-${index + 1}`,
        reviewerName: `Synthetic reviewer ${index + 1}`,
        rating: 4,
        text: `Synthetic review ${index + 1}`,
        languageCode: 'en',
        reviewedAt: NOW,
        contentExpiresAt: new Date('2027-09-11T10:00:00.000Z'),
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: index + 1,
        aiSourceByteLength: 20,
        aiSourceDigest: 'b'.repeat(64),
      })),
    )
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      headSequence: IMPORTED_REVIEWS,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.insert(outboxEvents).values(
      EVENT_IDS.map((id, index) => ({
        id,
        eventType: 'review.created',
        eventVersion: 1,
        payload: reviewCreated(index + 1).payload,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceContext: 'review',
        sourceAggregateId: REVIEW_IDS[index]!,
        createdAt: new Date(NOW.getTime() + index),
        publishedAt: NOW,
      })),
    )
  })

  afterAll(async () => {
    await clearFixture()
    clearEventSchemas()
  })

  it('keeps exact coverage when reviews are imported before the merchant enables AI', async () => {
    // Import: every review.created is consumed while no enablement row exists.
    for (let sequence = 1; sequence <= IMPORTED_REVIEWS; sequence += 1) {
      await expect(
        handleAiReviewEvent(
          { analyzeReviewEvent, receipts, enqueuePropertyTrend: async () => {} },
          reviewCreated(sequence),
        ),
      ).resolves.toEqual({ status: 'applied' })
    }
    await expect(lineageDerivatives()).resolves.toEqual({
      ledgerSequences: [],
      heads: [],
      receipted: IMPORTED_REVIEWS,
    })

    // First enable: epoch 1, watermark at the allocator head. The pre-enable
    // sequences are below it, so the window expects nothing yet and the read
    // that served a 500 in production returns an empty generation instead.
    await enableAtCurrentHead()
    await expect(aggregates.readWindow(windowRequest())).resolves.toBeNull()

    // The enrollment backfill re-allocates an eligible review a fresh sequence
    // inside the lineage; settling it is the first and only expected analysis.
    const backfillSequence = IMPORTED_REVIEWS + 1
    await db
      .update(reviewAiAnalysisHeads)
      .set({ headSequence: backfillSequence, updatedAt: NOW })
      .where(
        and(
          eq(reviewAiAnalysisHeads.organizationId, ORGANIZATION_ID),
          eq(reviewAiAnalysisHeads.propertyId, PROPERTY_ID),
        ),
      )
    await expect(
      settleReviewAnalysisWithoutResult(
        { reviewEvents, aggregates },
        {
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          reviewId: REVIEW_IDS[0]!,
          sourceEpoch: 0,
          reviewAnalysisEpoch: 1,
          analysisSequence: backfillSequence,
          propertyProfileVersion: 1,
          operationId: null,
          dispositionCode: 'language_not_supported',
        },
      ),
    ).resolves.toEqual({ status: 'terminal' })

    const window = await aggregates.readWindow(windowRequest())
    expect(window?.coverage).toEqual({
      settledAnalysisCount: 1,
      expectedAnalysisCount: 1,
      awaitingAnalysisCount: 0,
    })
  })
})
