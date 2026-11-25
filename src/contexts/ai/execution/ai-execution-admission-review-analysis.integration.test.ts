// A review analysis passes the same final authority as a reply, but the fence its
// contract adds is the review's analysis sequence, not its reply state: the call
// is admitted only while the review stands at the sequence the operation was
// claimed on, and a newer analysis sequence refuses it.

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import {
  aiOperations,
  aiOrganizationCostWindows,
  aiPropertyProcessingProfiles,
  reviewAiAnalysisHeads,
  reviews,
  reviewSourceContents,
} from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation/ai-operation-profiles'
import type { AiAdmissionDescriptorV1 } from '#/shared/ai-gateway/ai-internal-transport-contract'
import { REVIEW_ANALYSIS_NORMALIZATION_DIGEST } from '#/shared/analysis/normalizer'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  AI_CONTROL_SCOPE_KEYS,
  openAiExecutionControls,
  requireControl,
  type OpenAiExecutionControls,
} from '#/shared/db/testing/ai-execution-control-fixture'
import {
  installAiAnalysisFixture,
  type AiAnalysisFixture,
} from '#/shared/db/testing/ai-review-analysis-v3-fixture'
import { seedEnabledReviewAnalysis } from '#/shared/db/testing/enabled-review-analysis-fixture'
import { createAiExecutionAdmissionAdapter } from './ai-execution-admission.adapter.server'

type PropertyDescriptor = Extract<AiAdmissionDescriptorV1, { subjectKind: 'property' }>

const NOW = new Date(Date.now() - 60_000)
const ORGANIZATION_ID = organizationId('ai-admission-analysis-test-org')
const PROPERTY_ID = propertyId('76000000-0000-4000-8000-0000000000a1')
const LINEAGE_ID = '76000000-0000-4000-8000-0000000000a2'
const ACTOR_USER_ID = 'ai-admission-analysis-test-user'
const SOURCE_EPOCH = 0
const SOURCE_REVISION = 1
const CLAIMED_SEQUENCE = 1
const SOURCE_DIGEST = 'd'.repeat(64)
const SOURCE_BYTES = 40
const PAYLOAD_BYTES = 512

const profile = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'review-analysis-v3',
)
if (!profile?.capabilityRuntimeProfileVersion) {
  throw new Error('review-analysis-v3 profile is not registered')
}
const RUNTIME_PROFILE_VERSION = profile.capabilityRuntimeProfileVersion
const OPERATION_PROFILE_VERSION = profile.profileVersion
const PROVIDER_DEPLOYMENT_PROFILE_VERSION = profile.providerDeploymentProfileVersion
const [GLOBAL_SCOPE, PROVIDER_SCOPE, CAPABILITY_SCOPE] = AI_CONTROL_SCOPE_KEYS

function descriptor(input: {
  operationId: string
  permitId: string
}): PropertyDescriptor {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'review-analysis',
    operationId: input.operationId,
    permitId: input.permitId,
    attemptNumber: 1,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    internalSubjectId: 'subject-1',
    actorId: null,
    binding: {
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
      sourceEpoch: SOURCE_EPOCH,
      evaluatedLanguage: 'en',
      concreteReplyLanguage: null,
      languageCatalogueDigest: null,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: SOURCE_REVISION,
      reviewedAtEpochMillis: NOW.getTime(),
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: 'e'.repeat(64),
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      aiSubjectHmacKeyVersion: null,
      stopFence: {
        globalControlId: '76000000-0000-4000-8000-0000000000b1',
        globalGeneration: 1,
        providerControlId: '76000000-0000-4000-8000-0000000000b2',
        providerGeneration: 1,
        capabilityControlId: '76000000-0000-4000-8000-0000000000b3',
        capabilityGeneration: 1,
      },
      providerDeploymentProfileVersion: PROVIDER_DEPLOYMENT_PROFILE_VERSION,
      operationProfileVersion: OPERATION_PROFILE_VERSION,
      capabilityRuntimeProfileVersion: RUNTIME_PROFILE_VERSION,
    },
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    sourceDigest: SOURCE_DIGEST,
    preparedDigest: 'c'.repeat(64),
    sourceByteCount: SOURCE_BYTES,
    preparedByteCount: 256,
    providerPayloadByteCount: PAYLOAD_BYTES,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 1_024,
      providerPayloadBytes: 2_048,
      preparedRequestBytes: 4_096,
      responseBytes: 8_192,
      outputTokens: 64,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: NOW.getTime() + 70_000,
    observedContentExpiresAtEpochMillis: NOW.getTime() + 24 * 60 * 60_000,
    redactionCountry: 'US',
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}

describe.sequential(
  'AI execution admission of a review analysis (real PostgreSQL)',
  () => {
    const db = getDb()
    const authority = createAiExecutionAdmissionAdapter({
      pool: getPool(),
      now: () => NOW,
    })
    let fixture: AiAnalysisFixture
    let controls: OpenAiExecutionControls

    beforeAll(async () => {
      controls = await openAiExecutionControls(db, { actorUserId: ACTOR_USER_ID })
      fixture = await installAiAnalysisFixture({
        db,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        now: NOW,
      })
      // The consent's evidence names the Property's analysis head.
      await db.insert(reviewAiAnalysisHeads).values({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: SOURCE_EPOCH,
        createdAt: NOW,
        updatedAt: NOW,
      })
      await seedEnabledReviewAnalysis(db, {
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        authorizationLineageId: LINEAGE_ID,
        analysisStartSequence: 0,
        authorizedSourceEpoch: SOURCE_EPOCH,
        reviewAnalysisRuntimeVersion: RUNTIME_PROFILE_VERSION,
        providerDeploymentProfileVersion: PROVIDER_DEPLOYMENT_PROFILE_VERSION,
        actorUserId: ACTOR_USER_ID,
        occurredAt: NOW,
      })
      await db.insert(aiPropertyProcessingProfiles).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        countryCode: 'US',
        timezone: 'America/New_York',
        processingRegion: 'global',
        routingPolicyVersion: 1,
        providerDeploymentProfileVersion: PROVIDER_DEPLOYMENT_PROFILE_VERSION,
        sourceEpoch: SOURCE_EPOCH,
        profileVersion: 1,
        lifecycleState: 'active',
        updatedAt: NOW,
      })
    })

    afterAll(async () => {
      try {
        await db
          .delete(aiOperations)
          .where(eq(aiOperations.organizationId, ORGANIZATION_ID))
        await db
          .delete(aiOrganizationCostWindows)
          .where(eq(aiOrganizationCostWindows.organizationId, ORGANIZATION_ID))
        await fixture.remove()
      } finally {
        await controls.restore()
      }
    })

    /** A review at the claimed sequence and the analysis operation executing on it. */
    async function executingAnalysis() {
      const reviewId = randomUUID()
      const operationId = randomUUID()
      const permitId = randomUUID()
      const global = requireControl(controls.heads, GLOBAL_SCOPE)
      const provider = requireControl(controls.heads, PROVIDER_SCOPE)
      const capability = requireControl(controls.heads, CAPABILITY_SCOPE)
      await db.insert(reviews).values({
        id: reviewId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        firstFetchedAt: NOW,
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        analysisSequence: CLAIMED_SEQUENCE,
      })
      await db.insert(reviewSourceContents).values({
        reviewId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        platform: 'google',
        externalId: `ai-admission-analysis-${reviewId}`,
        externalLocationId: 'locations/ai-admission-analysis',
        reviewerName: 'Synthetic reviewer',
        rating: 2,
        text: 'Synthetic review',
        languageCode: 'en',
        reviewedAt: NOW,
        firstFetchedAt: NOW,
        lastFetchedAt: NOW,
        contentExpiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        aiSourceByteLength: SOURCE_BYTES,
        aiSourceDigest: SOURCE_DIGEST,
      })
      await db.insert(aiOperations).values({
        id: operationId,
        idempotencyScope: `analysis:${operationId}`,
        idempotencyKey: operationId,
        requestFingerprint: 'f'.repeat(64),
        sourceDigest: SOURCE_DIGEST,
        sourceByteCount: SOURCE_BYTES,
        command: 'analysis',
        capability: 'review_analysis',
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        actorUserId: null,
        systemPrincipal: 'review_event_consumer',
        reviewId,
        originEventId: randomUUID(),
        subjectHmac: 'd'.repeat(64),
        subjectHmacKeyVersion: 'ai-admission-analysis-test-v1',
        sourceEpoch: SOURCE_EPOCH,
        sourceRevision: SOURCE_REVISION,
        reviewedAtEpochMillis: NOW.getTime(),
        analysisSequence: CLAIMED_SEQUENCE,
        authorizationLineageId: LINEAGE_ID,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        evaluatedLanguage: 'en',
        propertyProfileVersion: 1,
        routingPolicyVersion: 1,
        providerDeploymentProfileVersion: PROVIDER_DEPLOYMENT_PROFILE_VERSION,
        operationProfileVersion: OPERATION_PROFILE_VERSION,
        capabilityRuntimeProfileVersion: RUNTIME_PROFILE_VERSION,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        sourceCanonicalizerDigest: 'e'.repeat(64),
        redactionProfileVersion: 'gbp-review-global-v1',
        globalControlId: global.controlId,
        globalControlGeneration: global.generation,
        providerControlId: provider.controlId,
        providerControlGeneration: provider.generation,
        capabilityControlId: capability.controlId,
        capabilityControlGeneration: capability.generation,
        capabilityFences: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
        routeKey: 'review-analysis',
        state: 'executing',
        executionAttempt: 1,
        executionPermitId: permitId,
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 60 * 60_000),
        providerId: 'openai',
        providerModel: 'synthetic-model-2026-10-01',
        providerRequestProfileVersion: 'synthetic-request-profile-v1',
        providerRequestProfileDigest: '1'.repeat(64),
        vocabularyHintSetId: 'generic-service',
        vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
        vocabularyHintSetDigest: '2'.repeat(64),
        normalizationProfileVersion: 'review-analysis-normalization-v1',
        normalizationProfileDigest: REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
      })
      return { reviewId, operationId, permitId }
    }

    it('admits the executing analysis while the review stands at the sequence it was claimed on', async () => {
      const subject = await executingAnalysis()

      await expect(authority.authorize(descriptor(subject))).resolves.toMatchObject({
        status: 'admitted',
        admission: { operationId: subject.operationId, permitId: subject.permitId },
      })
    })

    it('refuses once the review moved to a newer analysis sequence after the claim', async () => {
      const subject = await executingAnalysis()
      await db
        .update(reviews)
        .set({ analysisSequence: CLAIMED_SEQUENCE + 1 })
        .where(eq(reviews.id, subject.reviewId))

      await expect(authority.authorize(descriptor(subject))).resolves.toEqual({
        status: 'denied',
        code: 'source_mismatch',
      })
      const [operation] = await db
        .select({ costWindowId: aiOperations.costWindowId })
        .from(aiOperations)
        .where(eq(aiOperations.id, subject.operationId))
      expect(operation?.costWindowId).toBeNull()
    })
  },
)
