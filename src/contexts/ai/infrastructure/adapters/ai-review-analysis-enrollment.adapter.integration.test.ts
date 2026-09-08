import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  aiExecutionControlHeads,
  aiOperations,
  aiReviewAnalysisEnrollments,
  eventConsumerReceipts,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  AI_EXECUTION_ABANDONED_AFTER_MILLIS,
  createAiOperationExecutionReaper,
} from '../../application/ai-operation-execution-reaper'
import { AI_REVIEW_ANALYSIS_CONSUMER } from '../outbox-consumers'
import { createAiOperationStoreAdapter } from './ai-operation-store.adapter'
import { createAiPropertyAggregateStoreAdapter } from './ai-property-aggregate-store.adapter'
import { createAiReviewEventStoreAdapter } from './ai-review-event-store.adapter'
import { createReviewAnalysisEnrollmentAdapter } from './ai-review-analysis-enrollment.adapter'

const NOW = new Date('2026-09-08T10:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-enrollment-adapter-test-org')
const PROPERTY_ID = propertyId('74000000-0000-4000-8000-000000000001')
const LINEAGE_ID = '74000000-0000-4000-8000-000000000002'
const TRIGGER_EVENT_ID = '74000000-0000-4000-8000-000000000003'
const ENROLLMENT_ID = '74000000-0000-4000-8000-000000000004'
// sha256 of the empty revision set: no eligible review exists for the property.
const EMPTY_SET_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('Review Analysis enrollment adapter (real PostgreSQL)', () => {
  const db = getDb()
  const enrollments = createReviewAnalysisEnrollmentAdapter(db, () => ENROLLMENT_ID)

  const clear = async () => {
    await db
      .delete(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, TRIGGER_EVENT_ID))
    await db.delete(outboxEvents).where(eq(outboxEvents.id, TRIGGER_EVENT_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    clearEventSchemas()
    registerAllEventSchemas()
    await clear()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI enrollment adapter test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI enrollment test property',
      slug: 'ai-enrollment-test-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 1,
      sourceEpoch: 0,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      headSequence: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
          reply_drafting: 'reply-drafting-runtime-v1',
          property_trends: 'property-trends-runtime-v1',
        },
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
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: 'ai-enrollment-test-actor',
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-enrollment-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
          reply_drafting: 'reply-drafting-runtime-v1',
          property_trends: 'property-trends-runtime-v1',
        },
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: 0,
        analysisStartSequence: 0,
        stateVersion: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        routingPolicyVersion: 1,
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: 'ai-enrollment-test-actor',
        updatedAt: NOW,
      })
    })
    await db.insert(outboxEvents).values({
      id: TRIGGER_EVENT_ID,
      eventType: 'identity.merchant_ai.changed',
      eventVersion: 1,
      payload: { state: 'enabled' },
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceContext: 'identity',
      sourceAggregateId: PROPERTY_ID,
      createdAt: NOW,
    })
  })

  afterAll(async () => {
    await clear()
    clearEventSchemas()
  })

  it('enrols an enabled property by snapshotting its eligible revisions with the built-in sha256', async () => {
    // The digest used to come from pgcrypto's digest(); no cell installs pgcrypto,
    // so the first live enablement failed here and retried forever.
    const result = await enrollments.applyAuthorizationLifecycle({
      eventEnvelopeId: TRIGGER_EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationState: 'enabled',
      fence: {
        authorizationLineageId: LINEAGE_ID,
        authorizationStateVersion: 1,
        sourceEpoch: 0,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        analysisStartSequence: 0,
      },
      correlationId: null,
      occurredAt: NOW,
    })

    expect(result).toEqual({
      status: 'applied',
      enrollment: { status: 'queued', enrollmentId: ENROLLMENT_ID },
    })

    const [row] = await db
      .select({
        state: aiReviewAnalysisEnrollments.state,
        count: aiReviewAnalysisEnrollments.snapshotRevisionCount,
        digest: aiReviewAnalysisEnrollments.snapshotRevisionSetDigest,
      })
      .from(aiReviewAnalysisEnrollments)
      .where(eq(aiReviewAnalysisEnrollments.id, ENROLLMENT_ID))
    expect(row).toEqual({ state: 'queued', count: 0, digest: EMPTY_SET_SHA256 })

    const [receipt] = await db
      .select({ status: eventConsumerReceipts.status })
      .from(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, TRIGGER_EVENT_ID))
    expect(receipt).toEqual({ status: 'applied' })
  })

  it('records a duplicate trigger without a second enrollment', async () => {
    const result = await enrollments.applyAuthorizationLifecycle({
      eventEnvelopeId: TRIGGER_EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationState: 'enabled',
      fence: {
        authorizationLineageId: LINEAGE_ID,
        authorizationStateVersion: 1,
        sourceEpoch: 0,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        analysisStartSequence: 0,
      },
      correlationId: null,
      occurredAt: NOW,
    })
    expect(result).toEqual({ status: 'duplicate', enrollmentId: ENROLLMENT_ID })
  })
  it('catches up after the reaper terminal-settles an abandoned pending revision', async () => {
    const reviewId = '74000000-0000-4000-8000-000000000005'
    const operationId = '74000000-0000-4000-8000-000000000006'
    const executionPermitId = '74000000-0000-4000-8000-000000000007'
    const expectedFence = {
      authorizationLineageId: LINEAGE_ID,
      authorizationStateVersion: 1,
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      analysisStartSequence: 0,
    }

    // Reconstruct the observed running enrollment from the public adapter:
    // one eligible pre-enablement revision is assigned a fresh strict sequence
    // and one correlated backfill event.
    await db
      .delete(aiReviewAnalysisEnrollments)
      .where(eq(aiReviewAnalysisEnrollments.id, ENROLLMENT_ID))
    await db
      .delete(eventConsumerReceipts)
      .where(eq(eventConsumerReceipts.eventId, TRIGGER_EVENT_ID))
    await db
      .delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORGANIZATION_ID),
          eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'),
        ),
      )
    await db.insert(reviews).values({
      id: reviewId,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      platform: 'google',
      externalId: 'ai-enrollment-abandoned-operation-review',
      reviewerName: 'Synthetic reviewer',
      rating: 5,
      text: 'Synthetic review content',
      languageCode: 'en',
      reviewedAt: NOW,
      contentExpiresAt: new Date('2027-09-08T10:00:00.000Z'),
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 0,
      aiSourceByteLength: 24,
      aiSourceDigest: 'a'.repeat(64),
    })
    await enrollments.applyAuthorizationLifecycle({
      eventEnvelopeId: TRIGGER_EVENT_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      authorizationState: 'enabled',
      fence: {
        ...expectedFence,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
      },
      correlationId: null,
      occurredAt: NOW,
    })
    await expect(
      enrollments.reconcile({
        enrollmentId: ENROLLMENT_ID,
        organizationId: ORGANIZATION_ID,
        expectedFence,
        correlationId: ENROLLMENT_ID,
        occurredAt: NOW,
      }),
    ).resolves.toEqual({
      status: 'replay_started',
      runId: ENROLLMENT_ID,
      pinnedRevisionCount: 1,
    })

    const [backfill] = await db
      .select({ id: outboxEvents.id, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, ORGANIZATION_ID),
          eq(outboxEvents.eventType, 'ai.review_analysis.backfill_requested'),
        ),
      )
      .limit(1)
    expect(backfill?.payload).toMatchObject({
      correlationId: ENROLLMENT_ID,
      reviewId,
      analysisSequence: 1,
    })
    if (!backfill) throw new Error('Review Analysis backfill event was not recorded')
    await db
      .update(outboxEvents)
      .set({ publishedAt: NOW })
      .where(eq(outboxEvents.id, backfill.id))

    const controls = await db
      .select({
        scopeKey: aiExecutionControlHeads.scopeKey,
        controlId: aiExecutionControlHeads.controlId,
        generation: aiExecutionControlHeads.generation,
      })
      .from(aiExecutionControlHeads)
    const control = (scopeKey: string) => {
      const found = controls.find((candidate) => candidate.scopeKey === scopeKey)
      if (!found) throw new Error(`AI execution control ${scopeKey} is not seeded`)
      return found
    }
    const globalControl = control('global')
    const providerControl = control(
      `provider:${AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion}`,
    )
    const capabilityControl = control('capability:review_analysis')
    await db.insert(aiOperations).values({
      id: operationId,
      idempotencyScope: `analysis:${operationId}`,
      idempotencyKey: `analysis:${backfill.id}`,
      requestFingerprint: 'b'.repeat(64),
      sourceDigest: 'c'.repeat(64),
      sourceByteCount: 24,
      command: 'analysis',
      capability: 'review_analysis',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId,
      originEventId: backfill.id,
      subjectHmac: 'd'.repeat(64),
      subjectHmacKeyVersion: 'ai-enrollment-test-v1',
      sourceEpoch: 0,
      sourceRevision: 1,
      reviewedAtEpochMillis: NOW.getTime(),
      analysisSequence: 1,
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      evaluatedLanguage: 'en',
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      operationProfileVersion: 'review-analysis-v1',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: 'e'.repeat(64),
      redactionProfileVersion: 'gbp-review-global-v1',
      globalControlId: globalControl.controlId,
      globalControlGeneration: globalControl.generation,
      providerControlId: providerControl.controlId,
      providerControlGeneration: providerControl.generation,
      capabilityControlId: capabilityControl.controlId,
      capabilityControlGeneration: capabilityControl.generation,
      capabilityFences: {
        capability: 'review_analysis',
        reviewAnalysisEpoch: 1,
      },
      routeKey: 'review-analysis',
      executionPermitId,
      state: 'pending',
      executionAttempt: 1,
      nextAttemptAt: new Date(NOW.getTime() + 30_000),
      failureCode: 'provider_rate_limited',
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
    })

    await expect(
      enrollments.reconcile({
        enrollmentId: ENROLLMENT_ID,
        organizationId: ORGANIZATION_ID,
        expectedFence,
        correlationId: ENROLLMENT_ID,
        occurredAt: NOW,
      }),
    ).resolves.toEqual({ status: 'waiting_for_replay' })

    const outbox = createOutboxRepository(db)
    const dependencies = {
      store: createAiOperationStoreAdapter(db, () => {
        throw new Error('The reaper does not create operation ids')
      }),
      reviewEvents: createAiReviewEventStoreAdapter(db),
      aggregates: createAiPropertyAggregateStoreAdapter(db),
      recordAnalysisReceipt: (eventId: string, status: 'applied' | 'obsolete') =>
        outbox.insertReceipt(eventId, AI_REVIEW_ANALYSIS_CONSUMER, status),
      nowEpochMillis: () => NOW.getTime() + AI_EXECUTION_ABANDONED_AFTER_MILLIS,
    }
    await expect(createAiOperationExecutionReaper(dependencies)()).resolves.toMatchObject(
      {
        abandonedVisited: 1,
        operationsFenced: 1,
      },
    )

    const [operation] = await db
      .select({ state: aiOperations.state, failureCode: aiOperations.failureCode })
      .from(aiOperations)
      .where(eq(aiOperations.id, operationId))
    expect(operation).toEqual({
      state: 'failed',
      failureCode: 'operation_abandoned',
    })
    await expect(
      enrollments.reconcile({
        enrollmentId: ENROLLMENT_ID,
        organizationId: ORGANIZATION_ID,
        expectedFence,
        correlationId: ENROLLMENT_ID,
        occurredAt: new Date(NOW.getTime() + AI_EXECUTION_ABANDONED_AFTER_MILLIS),
      }),
    ).resolves.toMatchObject({
      status: 'caught_up',
      eligibleRevisionCount: 1,
      caughtUpAnalysisSequence: 1,
    })
  })
})
