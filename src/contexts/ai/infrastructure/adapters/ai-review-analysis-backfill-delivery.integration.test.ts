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
  aiReviewAnalysisBackfillRuns,
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
import type { AiInferencePort } from '../../application/ports/ai-inference.port'
import type { AiQuotaPort } from '../../application/ports/ai-quota.port'
import type { AiSubjectHmacPort } from '../../application/ports/ai-subject-hmac.port'
import { createAnalyzeReviewEvent } from '../../application/use-cases/analyze-review-event'
import {
  AI_BACKFILL_ITEM_RECOVERY_MILLIS,
  createAdvanceReviewAnalysisBackfill,
} from '../../application/use-cases/advance-review-analysis-backfill'
import { createAiAuthorizationAdapter } from './ai-authorization.adapter'
import { createAiControlAdapter } from './ai-control.adapter'
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
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

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
/** BullMQ's dispatch budget for domain-events (relay.ts DISPATCH_JOB_OPTIONS). */
const DISPATCH_ATTEMPTS = 8

const RUNTIME_PROFILES = { review_analysis: 'review-analysis-runtime-v1' } as const
const RELEASE_SHA = '6'.repeat(40)
const DELIVERY_CANARY_AUTHORIZATION_ID = '7c000000-0000-4000-8000-000000000006'
const DELIVERY_CANARY_OPERATION_ID = '7c000000-0000-4000-8000-000000000007'
const DELIVERY_CANARY_HEAD_ID = '7c000000-0000-4000-8000-000000000008'

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
  /** One entry per provider call, so a doubly-consumed sequence is visible. */
  const analysisCalls: string[] = []
  const inference: AiInferencePort = {
    analyzeReview: async (input): Promise<AnalysisResult> => {
      analysisCalls.push(input.internalSubjectId)
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
   * `capability:review_analysis` ships killed/draining in the scratch database,
   * and `storeAnalysis` re-reads the REAL control heads before it commits — so
   * a fake control port would only move the failure. This activates the
   * capability through the real CAS adapter, exactly as the admission proof
   * does, and the suite therefore owns the state it depends on instead of
   * borrowing whatever an earlier file happened to leave enabled.
   */
  const controlsNow = new Date()
  const activateControls = async () => {
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
    const global = rows.find((row) => row.scopeKey === 'global')
    const provider = rows.find(
      (row) => row.scopeKey === 'provider:private-beta-global-v1',
    )
    const capability = rows.find((row) => row.scopeKey === 'capability:review_analysis')
    if (!global || !provider || !capability) throw new Error('seeded AI controls missing')

    await db.execute(sql`
      INSERT INTO ai_canary_authorizations (
        id, release_sha, canary_profile_version, authorization_generation,
        predecessor_authorization_id, nonce, operator_user_id, state,
        issued_at, expires_at, settled_at
      ) VALUES (
        ${DELIVERY_CANARY_AUTHORIZATION_ID}::uuid, ${RELEASE_SHA}, 'synthetic-canary-v1', 1,
        NULL, ${'b'.repeat(64)}, 'ai-reanalyze-delivery-operator', 'passed',
        ${new Date(controlsNow.getTime() - 1_000)}, ${new Date(controlsNow.getTime() + 60_000)}, ${controlsNow}
      )
      ON CONFLICT (id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ai_operations (
        id, idempotency_scope, idempotency_key, request_fingerprint,
        command, capability, system_principal, release_sha,
        canary_authorization_id, canary_authorization_generation,
        canary_profile_version, provider_deployment_profile_version,
        operation_profile_version, global_control_id, global_control_generation,
        provider_control_id, provider_control_generation, capability_control_id,
        capability_control_generation, capability_fences, state,
        execution_attempt, created_at, updated_at, expires_at
      ) VALUES (
        ${DELIVERY_CANARY_OPERATION_ID}::uuid, 'release-canary:reanalyze-admission',
        'passed-canary', ${'c'.repeat(64)}, 'synthetic_canary', NULL,
        'release_canary', ${RELEASE_SHA}, ${DELIVERY_CANARY_AUTHORIZATION_ID}::uuid, 1,
        'synthetic-canary-v1', 'private-beta-global-v1', 'synthetic-canary-v1',
        ${global.controlId}::uuid, ${global.generation},
        ${provider.controlId}::uuid, ${provider.generation}, NULL, NULL,
        jsonb_build_array(
          jsonb_build_object('capability', 'review_analysis'),
          jsonb_build_object('capability', 'reply_drafting'),
          jsonb_build_object('capability', 'property_trends')
        ),
        'succeeded', 1, ${new Date(controlsNow.getTime() - 1_000)}, ${controlsNow},
        ${new Date(controlsNow.getTime() + 60_000)}
      )
      ON CONFLICT (id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO ai_canary_authorization_heads (
        release_sha, canary_profile_version, head_id, transition_generation,
        next_authorization_generation, current_authorization_id,
        current_operation_id, current_permit_id, state, updated_at
      ) VALUES (
        ${RELEASE_SHA}, 'synthetic-canary-v1', ${DELIVERY_CANARY_HEAD_ID}::uuid, 3, 2,
        ${DELIVERY_CANARY_AUTHORIZATION_ID}::uuid, ${DELIVERY_CANARY_OPERATION_ID}::uuid, NULL,
        'passed', ${controlsNow}
      )
      ON CONFLICT (release_sha, canary_profile_version) DO NOTHING
    `)

    const activated = await createAiControlAdapter(db).transition({
      scope: { kind: 'capability', capability: 'review_analysis' },
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      expectedControlId: capability.controlId,
      expectedGeneration: capability.generation,
      executionState: 'enabled',
      admissionState: 'accepting',
      reasonCode: 'test_canary_passed',
      actorUserId: 'ai-reanalyze-delivery-operator',
      ticketReference: 'test-activate-reanalyze-delivery',
      candidateReleaseSha: RELEASE_SHA,
    })
    if (!activated) throw new Error('failed to activate review_analysis')
  }

  const clearCanary = async () => {
    await executeWithLastOwnerGuardDisabled(db, [
      sql`ALTER TABLE ai_canary_authorization_heads DISABLE TRIGGER USER`,
      sql`ALTER TABLE ai_canary_authorizations DISABLE TRIGGER USER`,
      sql`DELETE FROM ai_canary_authorization_heads WHERE release_sha = ${RELEASE_SHA}`,
      sql`DELETE FROM ai_operations WHERE release_sha = ${RELEASE_SHA}`,
      sql`DELETE FROM ai_canary_authorizations WHERE release_sha = ${RELEASE_SHA}`,
      sql`ALTER TABLE ai_canary_authorizations ENABLE TRIGGER USER`,
      sql`ALTER TABLE ai_canary_authorization_heads ENABLE TRIGGER USER`,
    ])
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
    registerAllEventSchemas()
    stubProcessVersions({
      node: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
      icu: AI_REVIEW_LANGUAGE_ICU_VERSION,
      unicode: AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/u, ''),
    })
    await clearCanary()
    await clear()
    await activateControls()
  })
  beforeEach(async () => {
    analysisCalls.length = 0
    await clear()
    await seed()
  })
  afterAll(async () => {
    stubProcessVersions(ACTUAL_PROCESS_VERSIONS as Readonly<Record<string, string>>)
    await clear()
    await clearCanary()
  })

  const createAnalysis = () => {
    const reviewRepository = createReviewRepository(db)
    return createAnalyzeReviewEvent({
      authorization: createAiAuthorizationAdapter(db),
      control: createAiControlAdapter(db),
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
  }

  /**
   * The advance driver. `nowEpochMillis` is injected so a test can put the clock
   * past the recovery horizon without sleeping half an hour.
   */
  const createAdvance = (clock: () => number = now) =>
    createAdvanceReviewAnalysisBackfill({
      backfillStore: createReviewAnalysisBackfillAdapter(db),
      reviewEvents: createAiReviewEventStoreAdapter(db),
      aggregates: createAiPropertyAggregateStoreAdapter(db),
      processingProfiles: createPropertyProcessingProfileAdapter(
        db,
        createAiRuntimeCatalogueAdapter(db),
      ),
      nowEpochMillis: clock,
    })

  const outcomeStates = async () =>
    (
      await db
        .select({
          sequence: aiReviewAnalysisOutcomes.analysisSequence,
          state: aiReviewAnalysisOutcomes.state,
        })
        .from(aiReviewAnalysisOutcomes)
        .where(eq(aiReviewAnalysisOutcomes.propertyId, PROPERTY_ID as string))
        .orderBy(asc(aiReviewAnalysisOutcomes.analysisSequence))
    ).map((row) => ({ sequence: row.sequence, state: row.state }))

  /**
   * Consume an event and stop there, leaving its outcome row `pending` with no
   * redelivery to come. That is precisely the state a `generation_changed`
   * left behind in production: the dispatcher wrote an `obsolete` receipt, so
   * the event was never offered again and the sequence could never settle.
   */
  const consumeOnly = async (
    event: ConsumerEvent,
    run: Readonly<{ reviewAnalysisEpoch: number; analysisStartSequence: number }>,
  ) => {
    const consumed = await createAiReviewEventStoreAdapter(db).consumeNext({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      reviewAnalysisEpoch: run.reviewAnalysisEpoch,
      analysisStartSequence: run.analysisStartSequence,
      analysisSequence: analysisSequenceOf(event),
      eventEnvelopeId: event.eventId,
      disposition: 'pending',
    })
    if (consumed.status !== 'accepted') {
      throw new Error(`expected the first item to consume, got ${consumed.status}`)
    }
  }

  const applyBackfill = async () => {
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
    return applied
  }

  it('completes a batch of five delivered out of order inside one epoch', async () => {
    // The chain's fast path: the consumer hands the run its next review the
    // moment this one settles. Nothing else drives it here — no sweep tick —
    // so this proves the hand-off, not the safety net.
    const consumerDeps = {
      analyzeReviewEvent: createAnalysis(),
      receipts: createOutboxRepository(db),
      enqueuePropertyTrend: async () => {},
      advanceReviewAnalysisBackfill: createAdvance().advanceProperty,
    }
    const runEpoch = (await applyBackfill()).reviewAnalysisEpoch

    // Drain the run the way the relay + dispatcher would. The outbox is
    // re-polled every round because the run emits as it goes, and each round
    // offers whatever is unsettled in a HOSTILE order — reversed, so a run that
    // ever put more than one event in flight would deliver them out of sequence
    // and gap. Bounded by the same attempt budget the relay configures.
    const settled = new Set<string>()
    let seen: ReadonlyArray<ConsumerEvent> = []
    for (let round = 0; round < REVIEW_COUNT * DISPATCH_ATTEMPTS; round++) {
      seen = await emittedEnvelopes()
      const unsettled = seen.filter((event) => !settled.has(event.eventId)).reverse()
      if (unsettled.length === 0) break
      for (const event of unsettled) {
        if ((await deliverOnce(consumerDeps, event)) === 'settled') {
          settled.add(event.eventId)
        }
      }
    }
    expect(seen).toHaveLength(REVIEW_COUNT)
    expect(settled.size).toBe(REVIEW_COUNT)

    const expectedSequences = seen.map(analysisSequenceOf).sort((a, b) => a - b)
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

  it('recovers a stranded item past the horizon and finishes the run', async () => {
    // The incident, reconstructed: the first item is consumed and its outcome
    // row opens `pending`, then delivery dies before it can settle — which is
    // exactly what an `obsolete` receipt on a `generation_changed` leaves
    // behind, redelivery included. Nothing will ever settle sequence 257 again.
    const consumerDeps = {
      analyzeReviewEvent: createAnalysis(),
      receipts: createOutboxRepository(db),
      enqueuePropertyTrend: async () => {},
      // No hand-off: this test drives the safety net, not the fast path.
      advanceReviewAnalysisBackfill: async () => 'idle' as const,
    }
    const applied = await applyBackfill()
    const runEpoch = applied.reviewAnalysisEpoch
    const strandedSequence = applied.firstAnalysisSequence

    const [first] = await emittedEnvelopes()
    await consumeOnly(first!, applied)
    expect(await outcomeStates()).toEqual([
      { sequence: strandedSequence, state: 'pending' },
    ])
    const providerCallsBeforeRecovery = analysisCalls.length

    // Before the horizon the sweep must WAIT. Recovering here would discard a
    // review whose provider call is still in flight, and a rate-limited retry
    // is the ordinary case that looks identical from the outside.
    const early = createAdvance(() => now() + AI_BACKFILL_ITEM_RECOVERY_MILLIS - 1_000)
    expect(await early.sweep()).toMatchObject({
      runsVisited: 1,
      itemsRecovered: 0,
      itemsEmitted: 0,
    })
    expect(await emittedEnvelopes()).toHaveLength(1)

    // Past it, the item is unreachable: the domain terminal-settles at its own
    // 15-minute horizon on any redelivery, and the execution reaper fences an
    // abandoned attempt on the same clock, so nothing legitimate is still
    // working on this sequence.
    const late = createAdvance(() => now() + AI_BACKFILL_ITEM_RECOVERY_MILLIS + 1_000)
    const swept = await late.sweep()
    expect(swept).toMatchObject({ runsVisited: 1, itemsRecovered: 1, itemsEmitted: 1 })

    const [runRow] = await db
      .select()
      .from(aiReviewAnalysisBackfillRuns)
      .where(eq(aiReviewAnalysisBackfillRuns.propertyId, PROPERTY_ID as string))
    expect(runRow).toMatchObject({
      state: 'running',
      recoveredReviewCount: 1,
      emittedReviewCount: 2,
    })
    // Settled terminal, not retried: the provider may already have been charged
    // for 257, and a second call would bill the merchant twice for one review.
    expect(await outcomeStates()).toEqual([
      { sequence: strandedSequence, state: 'terminal_no_result' },
    ])
    // The run moved on: the next item is out on the outbox, awaiting its
    // consumer, rather than the run sitting on a sequence that can never answer.
    expect((await emittedEnvelopes()).map(analysisSequenceOf)).toEqual([
      strandedSequence,
      strandedSequence + 1,
    ])
    expect(analysisCalls).toHaveLength(providerCallsBeforeRecovery)
    const [recovered] = await db
      .select({ dispositionCode: aiReviewAnalysisOutcomes.dispositionCode })
      .from(aiReviewAnalysisOutcomes)
      .where(
        and(
          eq(aiReviewAnalysisOutcomes.propertyId, PROPERTY_ID as string),
          eq(aiReviewAnalysisOutcomes.analysisSequence, strandedSequence),
        ),
      )
    expect(recovered?.dispositionCode).toBe('policy_disabled')

    // And the run is not halted by it: the remaining four still complete, in
    // the same epoch, with no operation left behind.
    const chained = {
      ...consumerDeps,
      advanceReviewAnalysisBackfill: createAdvance().advanceProperty,
    }
    const settled = new Set<string>([first!.eventId])
    for (let round = 0; round < REVIEW_COUNT * DISPATCH_ATTEMPTS; round++) {
      const seen = await emittedEnvelopes()
      const unsettled = seen.filter((event) => !settled.has(event.eventId)).reverse()
      if (unsettled.length === 0) break
      for (const event of unsettled) {
        if ((await deliverOnce(chained, event)) === 'settled') settled.add(event.eventId)
      }
    }

    const analyses = await db
      .select({ reviewAnalysisEpoch: aiReviewAnalyses.reviewAnalysisEpoch })
      .from(aiReviewAnalyses)
      .where(eq(aiReviewAnalyses.propertyId, PROPERTY_ID as string))
    const operations = await db
      .select({ state: aiOperations.state })
      .from(aiOperations)
      .where(eq(aiOperations.organizationId, ORGANIZATION_ID as string))
    const [closed] = await db
      .select()
      .from(aiReviewAnalysisBackfillRuns)
      .where(eq(aiReviewAnalysisBackfillRuns.propertyId, PROPERTY_ID as string))
    expect({
      runState: closed?.state,
      recovered: closed?.recoveredReviewCount,
      unsettled: (await outcomeStates()).filter((row) => row.state === 'pending'),
      analyses: analyses.length,
      analysisEpochs: [...new Set(analyses.map((row) => row.reviewAnalysisEpoch))],
      unfinishedOperations: operations.filter((row) => row.state !== 'succeeded'),
    }).toEqual({
      runState: 'completed',
      recovered: 1,
      unsettled: [],
      // Four of five: the recovered review is the one whose result was lost, and
      // it is counted, not silently dropped.
      analyses: REVIEW_COUNT - 1,
      analysisEpochs: [runEpoch],
      unfinishedOperations: [],
    })
  })

  it('stalls at a sequence the cursor never consumed instead of stepping over it', async () => {
    // The event was quarantined or lost before `consume_ai_review_event_v1` saw
    // it, so no outcome row exists. The cursor still expects this sequence:
    // emitting the next one would drop it into a permanent `gap` and stall
    // every later item behind a hole. Stopping loudly is the only safe move.
    const applied = await applyBackfill()
    const late = createAdvance(() => now() + AI_BACKFILL_ITEM_RECOVERY_MILLIS + 1_000)

    expect(await late.sweep()).toMatchObject({
      runsVisited: 1,
      runsStalled: 1,
      itemsEmitted: 0,
      itemsRecovered: 0,
    })

    const [runRow] = await db
      .select()
      .from(aiReviewAnalysisBackfillRuns)
      .where(eq(aiReviewAnalysisBackfillRuns.propertyId, PROPERTY_ID as string))
    expect(runRow).toMatchObject({
      state: 'stalled',
      terminalReason: 'item_never_consumed',
      emittedReviewCount: 1,
    })
    // Nothing emitted past the hole.
    expect(await emittedEnvelopes()).toHaveLength(1)
    expect(applied.firstAnalysisSequence).toBe(HEAD_SEQUENCE + 1)
  })
})
