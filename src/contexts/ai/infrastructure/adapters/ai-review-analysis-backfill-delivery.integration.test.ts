// Real-PostgreSQL proof that a MULTI-REVIEW backfill run actually completes.
//
// `ops:ai-reanalyze --batch-size 1` was clean twice on the closed beta.
// `--batch-size 5` burned five provider calls and delivered one analysis: four
// operations sat `executing` with settled `success` permits and no path
// forward, and the worker log named `AI review analysis sequence gap`.
//
// Two separate order dependencies produce that, and only the first is visible
// in the log:
//
//   1. DELIVERY ORDER. `consume_ai_review_event_v1` accepts only
//      `consumed_sequence + 1`. The relay publishes the run's N events to a
//      concurrency-20 dispatcher, so they arrive interleaved and most answer
//      `gap`. That is noisy but self-correcting — BullMQ retries.
//
//   2. THE ALLOCATION HEAD. `storeAnalysis` refuses unless
//      `review_ai_analysis_heads.head_sequence` still EQUALS the sequence being
//      stored, i.e. unless the analysis plane is caught up with the allocator.
//      A batch allocates `H+1 … H+N` in one transaction, so the head is `H+N`
//      before the first event is ever consumed, and `H+1 … H+N-1` can never be
//      stored. They return `generation_changed`, the dispatcher writes an
//      `obsolete` receipt, redelivery stops, and the operation is left
//      `executing` forever with the provider already paid.
//
// (2) is invisible with N=1 (`H+1 == H+N`), which is exactly why every existing
// test passed. Ordering delivery alone does NOT fix it. This test therefore
// asserts the outcome the feature promises rather than the mechanism: after a
// run of N delivered in a hostile order, every sequence terminal-settles inside
// ONE `review_analysis_epoch`, every review has its analysis, and no operation
// is left `executing`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisOutcomes,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  AI_REVIEW_LANGUAGE_ICU_VERSION,
  AI_REVIEW_LANGUAGE_UNICODE_VERSION,
} from '#/shared/ai-review-language-catalogue'
import { AI_REVIEW_LANGUAGE_REGION_NODE_VERSION } from '#/shared/generated/ai-review-language-canonical-regions-v1'
import {
  computeAiReviewSourceProvenance,
  createAiReviewSource,
} from '#/contexts/review/application/ai-review-source'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import type { ConsumerEvent } from '#/shared/outbox/dispatcher'
import type { AnalysisResult } from '#/shared/ai-gateway-transport-contract'
import type { AiControlPort } from '../../application/ports/ai-control.port'
import type { AiInferencePort } from '../../application/ports/ai-inference.port'
import type { AiQuotaPort } from '../../application/ports/ai-quota.port'
import type { AiSubjectHmacPort } from '../../application/ports/ai-subject-hmac.port'
import { createAnalyzeReviewEvent } from '../../application/use-cases/analyze-review-event'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter'
import { createAiReviewEventStoreAdapter } from './ai-review-event-store.adapter'
import { createAiRuntimeCatalogueAdapter } from './ai-runtime-catalogue.adapter'
import { createPropertyProcessingProfileAdapter } from './property-processing-profile.adapter'
import { handleAiReviewEvent } from '../outbox-consumers'
import { createBackfillReviewAnalysis } from '../../application/use-cases/backfill-review-analysis'
import { createReviewAnalysisBackfillAdapter } from './ai-review-analysis-backfill.adapter'
import { createPropertyGrantHolderLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'

const ORGANIZATION_ID = organizationId('ai-reanalyze-delivery-test-org')
const PROPERTY_ID = propertyId('7c000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '7c000000-0000-4000-8000-000000000002'
const CONNECTION_ID = '7c000000-0000-4000-8000-000000000003'
const CORRELATION_ID = '7c000000-0000-4000-8000-000000000004'
const ACTOR_USER_ID = 'ai-reanalyze-delivery-owner'
const SOURCE_EPOCH = 3
const HEAD_SEQUENCE = 256
const START_SEQUENCE = 40
const REVIEW_COUNT = 5
/** A hostile but deterministic arrival order: nothing arrives before its turn. */
const DELIVERY_ORDER = [4, 2, 0, 3, 1] as const
/** BullMQ's dispatch budget for domain-events (relay.ts DISPATCH_JOB_OPTIONS). */
const DISPATCH_ATTEMPTS = 8

const RUNTIME_PROFILES = { review_analysis: 'review-analysis-runtime-v1' } as const

const REVIEW_IDS = Array.from({ length: REVIEW_COUNT }, (_, index) =>
  reviewId(`7c000000-0000-4000-8000-1000000000${String(index).padStart(2, '0')}`),
)

/**
 * `mapReviewLanguageMetadata` fails closed unless the process matches the
 * node/ICU/Unicode triple pinned at image build time, and a drifted host would
 * turn every review here into a `language_runtime_unavailable` retry rather
 * than a provider call. The pin is stubbed so this suite's verdict does not
 * depend on which machine runs it — the same reason
 * `analyze-review-event.test.ts` stubs both directions.
 */
const ACTUAL_PROCESS_VERSIONS = process.versions
function stubProcessVersions(overrides: Readonly<Record<string, string>>): void {
  Object.defineProperty(process, 'versions', {
    value: { ...ACTUAL_PROCESS_VERSIONS, ...overrides },
    configurable: true,
    writable: false,
    enumerable: true,
  })
}

/** Deterministic per-review text, so each review carries its own digest. */
const reviewText = (index: number) =>
  `Backfill delivery candidate ${index} — the service here was consistently good.`

type DeliveryOutcome = 'settled' | 'retry'

describe('multi-review backfill delivery (real PostgreSQL)', () => {
  const db = getDb()
  const now = () => Date.now()

  const backfill = createBackfillReviewAnalysis({
    backfillStore: createReviewAnalysisBackfillAdapter(db),
    propertyAccessHolders: createPropertyGrantHolderLookup(db),
  })

  /**
   * The provider is faked and the control plane is read straight from the
   * seeded heads. Neither is this test's subject: admission and the kill
   * switches have their own real-SQL proofs
   * (`ai-review-analysis-backfill-admission.integration.test.ts`). What must be
   * real here is every store that carries an ordering invariant — the event
   * cursor, the allocation head, the outputs, the aggregates and the operation
   * state machine — and all of those are the production adapters.
   */
  const analysisCalls: number[] = []
  const inference: AiInferencePort = {
    analyzeReview: async (input): Promise<AnalysisResult> => {
      analysisCalls.push(input.binding.sourceRevision)
      return {
        route: 'review-analysis',
        status: 'success',
        result: {
          sentiment: 'positive',
          sentimentValence: 60,
          primaryCategory: 'service',
          urgencySignals: [],
        },
        settlementReceipt: {
          version: 'ai-settlement-receipt-v1',
          receiptKid: 'receipt-v1',
          grantKid: 'grant-v1',
          operationId: input.operationId,
          permitId: input.permitId,
          attemptNumber: input.attemptNumber,
          nonce: 'a'.repeat(64),
          requestBindingHmac: 'b'.repeat(64),
          disposition: 'success',
          reportedDisposition: 'success',
          providerRetryable: false,
          usageKnown: true,
          inputTokens: 240,
          cachedInputTokens: 0,
          outputTokens: 80,
          reasoningTokens: 0,
          costMicros: 1_200,
          settledAtEpochMillis: Date.now(),
          settlementState: 'settled',
          receiptSignature: 'c'.repeat(86),
        },
      }
    },
    generateReply: () => {
      throw new Error('reply generation is not part of this test')
    },
    generateTrend: () => {
      throw new Error('trend generation is not part of this test')
    },
  }

  const quota: AiQuotaPort = {
    acquire: async () => ({
      ok: true,
      quotaId: 'delivery-test-quota',
      expiresAtEpochMillis: Date.now() + 60_000,
      remaining: 1_000,
    }),
    release: async () => {},
  }

  const subjectHmac: AiSubjectHmacPort = {
    sign: () => ({ keyVersion: 'ai-subject-hmac-v1', digest: 'd'.repeat(64) }),
  }

  /**
   * The seeded control heads, reported enabled. Their ids must be REAL:
   * `ai_operations` carries FKs onto `ai_execution_control_transitions`.
   */
  const createSeededControl = async (): Promise<AiControlPort> => {
    const rows = await db
      .select({
        scopeKey: aiExecutionControlHeads.scopeKey,
        controlId: aiExecutionControlHeads.controlId,
        generation: aiExecutionControlHeads.generation,
      })
      .from(aiExecutionControlHeads)
      .where(
        inArray(aiExecutionControlHeads.scopeKey, [
          'global',
          'provider:private-beta-global-v1',
          'capability:review_analysis',
        ]),
      )
    const head = (scopeKey: string) => {
      const found = rows.find((row) => row.scopeKey === scopeKey)
      if (!found) throw new Error(`seeded AI control head ${scopeKey} is missing`)
      return found
    }
    const global = head('global')
    const provider = head('provider:private-beta-global-v1')
    const capability = head('capability:review_analysis')
    return {
      readHeads: async () => [
        {
          scope: { kind: 'global' },
          controlId: global.controlId,
          generation: global.generation,
          executionState: 'enabled',
          admissionState: 'accepting',
          updatedAtEpochMillis: Date.now(),
        },
        {
          scope: {
            kind: 'provider_deployment_profile',
            providerDeploymentProfileVersion: 'private-beta-global-v1',
          },
          controlId: provider.controlId,
          generation: provider.generation,
          executionState: 'enabled',
          admissionState: 'accepting',
          updatedAtEpochMillis: Date.now(),
        },
        {
          scope: { kind: 'capability', capability: 'review_analysis' },
          controlId: capability.controlId,
          generation: capability.generation,
          executionState: 'enabled',
          admissionState: 'accepting',
          updatedAtEpochMillis: Date.now(),
        },
      ],
      transition: async () => null,
    }
  }

  const clear = async () => {
    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
      // Before the operations: `ai_review_analyses.operation_id` restricts, and
      // the analyses only go away with the property that cascades them.
      sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}::uuid`,
      sql`DELETE FROM ai_operations WHERE organization_id = ${ORGANIZATION_ID}`,
      sql`DELETE FROM google_connections WHERE organization_id = ${ORGANIZATION_ID}`,
      sql`DELETE FROM member WHERE "organizationId" = ${ORGANIZATION_ID}`,
      sql`DELETE FROM "user" WHERE id = ${ACTOR_USER_ID}`,
      sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`,
    ])
  }

  const seed = async () => {
    const contentExpiresAt = new Date(Date.now() + 365 * 86_400_000)
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI reanalyze delivery test', ${ORGANIZATION_ID}, now())
    `)
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES (${ACTOR_USER_ID}, 'Delivery owner', ${`${ACTOR_USER_ID}@example.test`}, true)
    `)
    await db.execute(sql`
      INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
      VALUES (${`${ACTOR_USER_ID}-member`}, ${ORGANIZATION_ID}, ${ACTOR_USER_ID}, 'owner', now())
    `)
    await db.execute(sql`
      INSERT INTO google_connections (
        id, organization_id, google_subject, encrypted_access_token,
        encrypted_refresh_token, token_expires_at, scopes, connected_by, status,
        credential_use_state
      ) VALUES (
        ${CONNECTION_ID}::uuid, ${ORGANIZATION_ID}, 'google-subject-ai-delivery',
        'encrypted-access', 'encrypted-refresh', now(),
        ARRAY['https://www.googleapis.com/auth/business.manage']::text[],
        ${ACTOR_USER_ID}, 'active', 'active'
      )
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      googleConnectionId: CONNECTION_ID,
      gbpAccountId: '117637856120281336154',
      gbpLocationId: '15441257785345231367',
      organizationId: ORGANIZATION_ID,
      name: 'AI reanalyze delivery test property',
      slug: 'ai-reanalyze-delivery-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      processingRegion: 'global',
      googleBindingState: 'active',
      sourceEpoch: SOURCE_EPOCH,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      headSequence: HEAD_SEQUENCE,
    })
    for (const [index, id] of REVIEW_IDS.entries()) {
      const reviewedAt = new Date(Date.now() - (REVIEW_COUNT - index) * 86_400_000)
      // `readForAi` recomputes this provenance and refuses the source when the
      // stored digest disagrees, so it is derived, never invented.
      const provenance = computeAiReviewSourceProvenance({
        text: reviewText(index),
        rating: 5,
        languageCode: 'en',
        reviewedAtEpochMillis: reviewedAt.getTime(),
        reviewerDisplayName: null,
      })
      await db.insert(reviews).values({
        id,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: `ai-reanalyze-delivery-review-${index}`,
        externalLocationId: 'locations/ai-reanalyze-delivery',
        rating: 5,
        text: reviewText(index),
        languageCode: 'en',
        reviewedAt,
        expiresAt: contentExpiresAt,
        contentExpiresAt,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: index + 1,
        // Below the enablement watermark: history the merchant's enablement
        // skipped, which is exactly what the backfill exists to replay.
        analysisSequence: 0,
        aiSourceByteLength: provenance.byteLength,
        aiSourceDigest: provenance.digest,
      })
    }
    await db.insert(aiPropertyProcessingProfiles).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      countryCode: 'US',
      timezone: 'America/New_York',
      processingRegion: 'global',
      sourceEpoch: SOURCE_EPOCH,
      profileVersion: 3,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      routingPolicyVersion: 1,
      lifecycleState: 'active',
      updatedAt: new Date(),
    })
    const shared = {
      organizationId: ORGANIZATION_ID as string,
      propertyId: PROPERTY_ID as string,
      state: 'enabled',
      capabilities: ['review_analysis'],
      capabilityRuntimeProfileVersions: RUNTIME_PROFILES,
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: SOURCE_EPOCH,
      analysisStartSequence: START_SEQUENCE,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      routingPolicyVersion: 1,
      processingRegion: 'global',
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      redactionProfileFamily: 'gbp-review-global-v1',
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        actorUserId: ACTOR_USER_ID,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-reanalyze-delivery-enable-v1',
        requestHash: '2'.repeat(64),
        occurredAt: new Date(),
      })
      await tx.insert(merchantAiEnablement).values({
        ...shared,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        updatedBy: ACTOR_USER_ID,
        updatedAt: new Date(),
      })
    })
  }

  /** Every backfill event this run emitted, oldest first. */
  const emittedEnvelopes = async (): Promise<ReadonlyArray<ConsumerEvent>> => {
    const rows = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORGANIZATION_ID as string),
          eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
    return rows.map((row) => ({
      eventId: row.id,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      payload: row.payload,
      organizationId: row.organizationId,
      propertyId: row.propertyId,
      sourceContext: row.sourceContext,
      sourceAggregateId: row.sourceAggregateId,
      recordedAt: new Date().toISOString(),
      correlationId: CORRELATION_ID,
      causationId: null,
      sourceAggregateVersion: null,
      region: 'unscoped' as const,
    }))
  }

  const analysisSequenceOf = (event: ConsumerEvent): number => {
    const payload = event.payload as Readonly<{ analysisSequence: number }>
    return payload.analysisSequence
  }

  /**
   * One dispatch attempt, exactly as the domain-events worker performs it: the
   * consumer runs, a throw is a BullMQ retry, and a return (including the
   * `obsolete` receipt a `generation_changed` writes) ends redelivery.
   */
  const deliverOnce = async (
    deps: Parameters<typeof handleAiReviewEvent>[0],
    event: ConsumerEvent,
  ): Promise<DeliveryOutcome> => {
    try {
      await handleAiReviewEvent(deps, event)
      return 'settled'
    } catch {
      return 'retry'
    }
  }

  beforeAll(async () => {
    stubProcessVersions({
      node: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
      icu: AI_REVIEW_LANGUAGE_ICU_VERSION,
      unicode: AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/u, ''),
    })
    await clear()
  })
  beforeEach(async () => {
    analysisCalls.length = 0
    await clear()
    await seed()
  })
  afterAll(async () => {
    stubProcessVersions(ACTUAL_PROCESS_VERSIONS as Readonly<Record<string, string>>)
    await clear()
  })

  it('completes a batch of five delivered out of order inside one epoch', async () => {
    const reviewRepository = createReviewRepository(db)
    const analyzeReviewEvent = createAnalyzeReviewEvent({
      authorization: createAiAuthorizationAdapter(db),
      control: await createSeededControl(),
      inference,
      operations: createAiOperationStoreAdapter(db),
      outputs: createAiOutputStoreAdapter(db),
      aggregates: createAiPropertyAggregateStoreAdapter(db),
      quota,
      reviewEvents: createAiReviewEventStoreAdapter(db),
      reviewSources: createAiReviewSource({
        readForAi: reviewRepository.readForAi,
        assertCurrentForAi: reviewRepository.assertCurrentForAi,
        readReplyStateRevision: reviewRepository.readReplyStateRevision,
      }),
      processingProfiles: createPropertyProcessingProfileAdapter(
        db,
        createAiRuntimeCatalogueAdapter(db),
      ),
      subjectHmac,
      nowEpochMillis: now,
    })
    const consumerDeps = {
      analyzeReviewEvent,
      receipts: createOutboxRepository(db),
      enqueuePropertyTrend: async () => {},
    }

    const applied = await backfill({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      limit: REVIEW_COUNT,
      dryRun: false,
      reasonCode: 'operator_review_analysis_backfill',
      idempotencyKey: 'ops-ai-reanalyze:delivery-integration',
      requestHash: 'b'.repeat(64),
      correlationId: CORRELATION_ID,
      occurredAt: new Date(),
    })
    if (applied.status !== 'applied') {
      throw new Error(`backfill refused: ${JSON.stringify(applied)}`)
    }
    const runEpoch = applied.reviewAnalysisEpoch

    // Drain the run the way the dispatcher would: a hostile arrival order,
    // bounded by the same attempt budget the relay configures. Every event that
    // has not permanently settled is re-offered on the next round.
    const pending = new Set<string>()
    const events = await emittedEnvelopes()
    expect(events).toHaveLength(REVIEW_COUNT)
    for (const event of events) pending.add(event.eventId)

    for (let attempt = 0; attempt < DISPATCH_ATTEMPTS && pending.size > 0; attempt++) {
      for (const index of DELIVERY_ORDER) {
        const event = events[index]!
        if (!pending.has(event.eventId)) continue
        if ((await deliverOnce(consumerDeps, event)) === 'settled') {
          pending.delete(event.eventId)
        }
      }
    }
    expect([...pending]).toEqual([])

    const expectedSequences = events.map(analysisSequenceOf).sort((a, b) => a - b)
    const outcomes = await db
      .select({
        analysisSequence: aiReviewAnalysisOutcomes.analysisSequence,
        reviewAnalysisEpoch: aiReviewAnalysisOutcomes.reviewAnalysisEpoch,
        state: aiReviewAnalysisOutcomes.state,
      })
      .from(aiReviewAnalysisOutcomes)
      .where(
        and(
          eq(aiReviewAnalysisOutcomes.organizationId, ORGANIZATION_ID as string),
          eq(aiReviewAnalysisOutcomes.propertyId, PROPERTY_ID as string),
        ),
      )
      .orderBy(asc(aiReviewAnalysisOutcomes.analysisSequence))
    const analyses = await db
      .select({
        reviewId: aiReviewAnalyses.reviewId,
        reviewAnalysisEpoch: aiReviewAnalyses.reviewAnalysisEpoch,
      })
      .from(aiReviewAnalyses)
      .where(
        and(
          eq(aiReviewAnalyses.organizationId, ORGANIZATION_ID as string),
          eq(aiReviewAnalyses.propertyId, PROPERTY_ID as string),
        ),
      )
    const operations = await db
      .select({ state: aiOperations.state })
      .from(aiOperations)
      .where(eq(aiOperations.organizationId, ORGANIZATION_ID as string))

    // One assertion over the whole run, so a failure reports every way the run
    // came apart rather than the first one — a partially delivered backfill is
    // only legible as a whole.
    expect({
      consumedSequences: outcomes.map((row) => row.analysisSequence),
      unsettledSequences: outcomes
        .filter((row) => row.state === 'pending')
        .map((row) => row.analysisSequence),
      outcomeEpochs: [...new Set(outcomes.map((row) => row.reviewAnalysisEpoch))],
      analysisEpochs: [...new Set(analyses.map((row) => row.reviewAnalysisEpoch))],
      analysedReviewIds: analyses.map((row) => row.reviewId).sort(),
      unfinishedOperationStates: operations
        .map((row) => row.state)
        .filter((state) => state !== 'succeeded')
        .sort(),
      providerCalls: analysisCalls.length,
    }).toEqual({
      consumedSequences: expectedSequences,
      unsettledSequences: [],
      outcomeEpochs: [runEpoch],
      analysisEpochs: [runEpoch],
      analysedReviewIds: [...REVIEW_IDS].sort(),
      unfinishedOperationStates: [],
      // No sequence consumed twice: exactly one provider call per review.
      providerCalls: REVIEW_COUNT,
    })
  })
})
