import { generateKeyPairSync } from 'node:crypto'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/ai-reply-template-catalogue'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { deleteAiDraftsForReview } from '#/shared/ai-provider-control/ai-draft-purge'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiOrganizationCostWindows,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  replies,
  reviews,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  digestRenderedReply,
  signAiReplyProvenance,
  type AiReplyProvenancePayloadV1,
  type AiReplyProvenancePayloadV2,
  type AiReplyProvenancePayloadV3,
} from '#/shared/ai-reply-provenance'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '#/shared/ai-personalized-reply-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createPropertyProcessingProfileAdapter } from '#/contexts/ai/infrastructure/adapters/property-processing-profile.adapter'
import { createReviewRepository } from './repositories/review.repository'
import { createAiSuggestedDraftStore } from './ai-suggested-draft-store'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { digestAiReplyBrandDisplayName } from '#/shared/ai-reply-brand-profile.server'

const NOW = new Date()
const ORGANIZATION_ID = organizationId('ai-suggested-draft-test-org')
const PROPERTY_ID = propertyId('74000000-0000-4000-8000-000000000001')
const REVIEW_ID = reviewId('74000000-0000-4000-8000-000000000002')
const ACTOR_USER_ID = userId('ai-suggested-draft-user')
const LINEAGE_ID = '74000000-0000-4000-8000-000000000003'
const SOURCE_EPOCH = 2
// Material Review Revisions are repository-owned and start at one. Fixtures
// must bind AI provenance to that canonical revision instead of attempting to
// inject an arbitrary provider counter through the upsert input.
const SOURCE_REVISION = 1
const SUGGESTION = 'Thank you for sharing your experience.'
const REQUEST_BINDING_HMAC = 'A'.repeat(43)
const BRAND_DISPLAY_NAME_DIGEST = digestAiReplyBrandDisplayName('Example Hotel')
const LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST =
  '86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769'
type ConsentContractFacts = Pick<
  typeof merchantAiEnablement.$inferInsert,
  `${'routing'}${'PolicyVersion'}` | `${'processing'}${'Region'}`
>

// These remain legal consent facts. Keep them separate from the product
// Property fixture and from the Review store's source-currentness checks.
const CONSENT_CONTRACT_FACTS = {
  ['routing' + 'PolicyVersion']: 1,
  ['processing' + 'Region']: 'global',
} as ConsentContractFacts

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

function provenanceToken(overrides: Partial<AiReplyProvenancePayloadV1> = {}): string {
  return signAiReplyProvenance(
    {
      version: 'ai-reply-provenance-v1',
      kid: 'provenance-v1',
      operationId: '74000000-0000-4000-8000-000000000004',
      actorId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      requestBindingHmac: 'A'.repeat(43),
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 0,
      replyDraftingEpoch: 1,
      propertyProfileVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'reply-suggestion-v1',
      modelSnapshot: 'gpt-5.4-mini-2026-03-17',
      promptVersion: 'reply-suggestion-prompt-v1',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      templateId: 'appreciation_positive',
      concreteLanguageTag: 'en-Latn-US',
      templateGroup: 'en-Latn',
      renderedSuggestionDigest: digestRenderedReply(SUGGESTION),
      tokenExpiresAtEpochMillis: NOW.getTime() + 5 * 60_000,
      draftExpiresAtEpochMillis: NOW.getTime() + 30 * 60_000,
      ...overrides,
    },
    privateKey,
  )
}

function personalizedProvenanceToken(
  overrides: Partial<AiReplyProvenancePayloadV2> = {},
): string {
  return signAiReplyProvenance(
    {
      version: 'ai-reply-provenance-v2',
      kid: 'provenance-v1',
      operationId: '74000000-0000-4000-8000-000000000005',
      actorId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      requestBindingHmac: 'A'.repeat(43),
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 1,
      replyDraftingEpoch: 1,
      propertyProfileVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'reply-suggestion-v1',
      replyProfileVersion: 'reply-draft-v1',
      replyProfileDigest: LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST,
      modelSnapshot: 'gpt-5.4-mini-2026-03-17',
      promptVersion: 'reply-suggestion-prompt-v1',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      concreteLanguageTag: 'en-Latn-US',
      templateGroup: 'en-Latn',
      renderedSuggestionDigest: digestRenderedReply(SUGGESTION),
      tokenExpiresAtEpochMillis: NOW.getTime() + 5 * 60_000,
      draftExpiresAtEpochMillis: NOW.getTime() + 30 * 60_000,
      ...overrides,
    },
    privateKey,
  )
}

function groundedProvenanceToken(
  overrides: Partial<AiReplyProvenancePayloadV3> = {},
): string {
  return signAiReplyProvenance(
    {
      version: 'ai-reply-provenance-v3',
      kid: 'provenance-v1',
      operationId: '74000000-0000-4000-8000-000000000007',
      actorId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      requestBindingHmac: REQUEST_BINDING_HMAC,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 2,
      replyDraftingEpoch: 1,
      propertyProfileVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'reply-suggestion-v1',
      replyProfileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
      replyProfileDigest: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
      modelSnapshot: 'gpt-5.4-mini-2026-03-17',
      promptVersion: 'reply-suggestion-prompt-v1',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      concreteLanguageTag: 'en-Latn-US',
      templateGroup: 'en-Latn',
      renderedSuggestionDigest: digestRenderedReply(SUGGESTION),
      tokenExpiresAtEpochMillis: NOW.getTime() + 5 * 60_000,
      draftExpiresAtEpochMillis: NOW.getTime() + 30 * 60_000,
      ...overrides,
    },
    privateKey,
  )
}

describe.sequential('AI suggested draft acceptance (real PostgreSQL)', () => {
  const db = getDb()
  let brandProfileCurrent = true
  const brandAuthorityCalls: Array<Readonly<Record<string, unknown>>> = []
  const store = createAiSuggestedDraftStore(db, new Map([['provenance-v1', publicKey]]), {
    isCurrentAiReplyBrandProfile: async (_tx, input) => {
      brandAuthorityCalls.push(input)
      return brandProfileCurrent
    },
  })

  let initialReplyControl:
    | Readonly<{
        controlId: string
        generation: number
        executionState: 'enabled' | 'killed'
        admissionState: 'accepting' | 'draining'
      }>
    | undefined

  const transitionReplyControl = async (
    executionState: 'enabled' | 'killed',
    admissionState: 'accepting' | 'draining',
  ) => {
    const [head] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, 'capability:reply_drafting'))
      .limit(1)
    if (!head) throw new Error('Reply drafting execution control is not seeded')
    if (
      head.executionState === executionState &&
      head.admissionState === admissionState
    ) {
      return
    }
    const occurredAt = new Date()
    const generation = head.generation + 1
    await db.transaction(async (tx) => {
      await tx.insert(aiExecutionControlTransitions).values({
        controlId: head.controlId,
        generation,
        predecessorGeneration: head.generation,
        scopeKey: head.scopeKey,
        scopeKind: head.scopeKind,
        scopeValue: head.scopeValue,
        executionState,
        admissionState,
        reasonCode: 'integration_test_transition',
        actorUserId: ACTOR_USER_ID,
        ticketReference: `ai-suggested-draft-${generation}`,
        candidateReleaseSha: null,
        occurredAt,
      })
      await tx
        .update(aiExecutionControlHeads)
        .set({
          generation,
          executionState,
          admissionState,
          updatedAt: occurredAt,
        })
        .where(
          sql`${aiExecutionControlHeads.scopeKey} = 'capability:reply_drafting'
            AND ${aiExecutionControlHeads.generation} = ${head.generation}`,
        )
    })
  }

  const seedSucceededReplyOperation = async (input: {
    operationId: string
    permitId: string
    sourceRevision: number
    baseReplyStateRevision: number
    replyBrandProfileVersion?: number
    replyBrandDisplayNameDigest?: string
  }) => {
    const [globalControl] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, 'global'))
      .limit(1)
    const [providerControl] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, 'provider:private-beta-global-v1'))
      .limit(1)
    const [capabilityControl] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, 'capability:reply_drafting'))
      .limit(1)
    if (!globalControl || !providerControl || !capabilityControl) {
      throw new Error('AI execution controls are not seeded')
    }
    const createdAt = new Date(NOW.getTime() - 60_000)
    const expiresAt = new Date(NOW.getTime() + 60 * 60_000)
    await db
      .insert(aiOrganizationCostWindows)
      .values({
        id: input.permitId,
        organizationId: ORGANIZATION_ID,
        windowStart: sql`date_trunc('month', now())`,
        reservedMicros: 0,
        settledMicros: 42,
        capMicros: 50_000_000,
        updatedAt: sql`now()`,
      })
      .onConflictDoNothing()
    await db.insert(aiOperations).values({
      id: input.operationId,
      idempotencyScope: `reply:${input.operationId}`,
      idempotencyKey: input.operationId,
      requestFingerprint: 'f'.repeat(64),
      sourceDigest: 'e'.repeat(64),
      sourceByteCount: 20,
      command: 'reply',
      capability: 'reply_drafting',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: ACTOR_USER_ID,
      systemPrincipal: null,
      reviewId: REVIEW_ID,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: input.sourceRevision,
      reviewedAtEpochMillis: NOW.getTime(),
      tone: 'professional',
      baseReplyStateRevision: input.baseReplyStateRevision,
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'reply-suggestion-v1',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
      replyBrandProfileVersion: input.replyBrandProfileVersion ?? null,
      replyBrandDisplayNameDigest: input.replyBrandDisplayNameDigest ?? null,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      redactionProfileVersion: 'gbp-review-global-v1',
      concreteReplyLanguageTag: 'en-Latn-US',
      concreteReplyTemplateGroup: 'en-Latn',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      capabilityFences: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: input.baseReplyStateRevision,
      },
      globalControlId: globalControl.controlId,
      globalControlGeneration: globalControl.generation,
      providerControlId: providerControl.controlId,
      providerControlGeneration: providerControl.generation,
      capabilityControlId: capabilityControl.controlId,
      capabilityControlGeneration: capabilityControl.generation,
      routeKey: 'reply-suggestion',
      executionPermitId: input.permitId,
      admissionNonce: `nonce-${input.operationId}`,
      requestBindingKeyId: 'binding-v1',
      requestBindingHmac: REQUEST_BINDING_HMAC,
      grantKid: 'grant-v1',
      costWindowId: input.permitId,
      reservedMicros: 50_000,
      actualMicros: 42,
      budgetReservedAt: createdAt,
      budgetSettledAt: NOW,
      state: 'succeeded',
      executionAttempt: 1,
      createdAt,
      updatedAt: NOW,
      expiresAt,
      deliveredAt: NOW,
    })
  }
  const clear = async () => {
    // Replies deliberately restrict Review deletion; remove test-owned child
    // rows before the Property cascade reaches the stable Review.
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORGANIZATION_ID}`)
    await db.delete(aiOrganizationCostWindows).where(eq(aiOrganizationCostWindows.organizationId, ORGANIZATION_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    const [replyControl] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, 'capability:reply_drafting'))
      .limit(1)
    if (!replyControl) throw new Error('Reply drafting execution control is not seeded')
    if (
      (replyControl.executionState !== 'enabled' &&
        replyControl.executionState !== 'killed') ||
      (replyControl.admissionState !== 'accepting' &&
        replyControl.admissionState !== 'draining')
    ) {
      throw new Error('Reply drafting execution control has an invalid state')
    }
    initialReplyControl = {
      controlId: replyControl.controlId,
      generation: replyControl.generation,
      executionState: replyControl.executionState,
      admissionState: replyControl.admissionState,
    }
    await transitionReplyControl('enabled', 'accepting')

    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'AI suggested draft test', ${ORGANIZATION_ID}, ${NOW})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'AI suggested draft property',
      slug: 'ai-suggested-draft-property',
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 3,
      sourceEpoch: SOURCE_EPOCH,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: SOURCE_EPOCH,
      headSequence: 11,
      createdAt: NOW,
      updatedAt: NOW,
    })
    const profiles = createPropertyProcessingProfileAdapter(db, () => NOW)
    await expect(
      profiles.refreshForAi({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toMatchObject({ status: 'available', profile: { profileVersion: 1 } })

    const capabilityRuntimeProfileVersions = {
      reply_drafting: 'reply-drafting-runtime-v1',
    } as const
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        authorizationLineageId: LINEAGE_ID,
        stateVersion: 1,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        transitionKind: 'enable',
        state: 'enabled',
        capabilities: ['reply_drafting'],
        capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: SOURCE_EPOCH,
        analysisStartSequence: 11,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        ...CONSENT_CONTRACT_FACTS,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        actorUserId: ACTOR_USER_ID,
        reasonCode: 'merchant_enabled',
        idempotencyKey: 'ai-suggested-draft-enable-v1',
        requestHash: 'c'.repeat(64),
        occurredAt: NOW,
      })
      await tx.insert(merchantAiEnablement).values({
        propertyId: PROPERTY_ID,
        organizationId: ORGANIZATION_ID,
        authorizationLineageId: LINEAGE_ID,
        state: 'enabled',
        capabilities: ['reply_drafting'],
        capabilityRuntimeProfileVersions,
        reviewAnalysisEpoch: 1,
        replyDraftingEpoch: 1,
        propertyTrendsEpoch: 1,
        authorizedSourceEpoch: SOURCE_EPOCH,
        analysisStartSequence: 11,
        stateVersion: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        ...CONSENT_CONTRACT_FACTS,
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        redactionProfileFamily: 'gbp-review-global-v1',
        updatedBy: ACTOR_USER_ID,
        updatedAt: NOW,
      })
    })

    await createReviewRepository(db, () => new Date()).upsert({
      id: REVIEW_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      platform: 'google',
      externalId: 'ai-suggested-draft-review',
      externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      googleConnectionId: null,
      reviewerName: 'Guest',
      reviewerProfilePhotoUrl: null,
      rating: 5,
      text: 'A thoughtful review',
      translatedText: null,
      languageCode: 'en',
      reviewedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000),
      sentimentLabel: null,
      sentimentScore: null,
      sourceCreatedAt: NOW,
      sourceUpdatedAt: NOW,
      firstFetchedAt: NOW,
      lastFetchedAt: NOW,
      contentExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
      contentHash: 'd'.repeat(64),
      sourceSeenGeneration: null,
      sourceEpoch: SOURCE_EPOCH,
      sourceRevision: SOURCE_REVISION,
      analysisSequence: 11,
      aiSourceByteLength: 20,
      aiSourceDigest: 'e'.repeat(64),
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000004',
      permitId: '74000000-0000-4000-8000-000000000104',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 0,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000005',
      permitId: '74000000-0000-4000-8000-000000000105',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 1,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000006',
      permitId: '74000000-0000-4000-8000-000000000106',
      sourceRevision: SOURCE_REVISION + 1,
      baseReplyStateRevision: 1,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000007',
      permitId: '74000000-0000-4000-8000-000000000107',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 2,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000008',
      permitId: '74000000-0000-4000-8000-000000000108',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 2,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
  })

  afterAll(async () => {
    await clear()
    if (initialReplyControl) {
      await transitionReplyControl(
        initialReplyControl.executionState,
        initialReplyControl.admissionState,
      )
    }
  })

  it('persists exact signed provenance and replays the same adoption idempotently', async () => {
    const token = provenanceToken()
    const accepted = await store.accept({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      actorUserId: ACTOR_USER_ID,
      text: SUGGESTION,
      provenanceToken: token,
      now: NOW,
    })

    expect(accepted).toMatchObject({
      status: 'accepted',
      reply: {
        text: SUGGESTION,
        aiGenerated: true,
        replyLanguageTag: 'en-Latn-US',
        stateRevision: 1,
      },
    })
    const [persisted] = await db
      .select({
        authorship: replies.authorship,
        originOperationId: replies.originOperationId,
        originSourceRevision: replies.originSourceRevision,
        originTemplateId: replies.originReplyTemplateId,
        originConcreteLanguageTag: replies.originConcreteLanguageTag,
        originTemplateGroup: replies.originTemplateGroup,
        replyLanguageTag: replies.replyLanguageTag,
        replyStateRevision: reviews.replyStateRevision,
      })
      .from(replies)
      .innerJoin(reviews, eq(reviews.id, replies.reviewId))
      .where(eq(replies.reviewId, REVIEW_ID))
      .limit(1)
    expect(persisted).toEqual({
      authorship: 'ai_assisted',
      originOperationId: '74000000-0000-4000-8000-000000000004',
      originSourceRevision: SOURCE_REVISION,
      originTemplateId: 'appreciation_positive',
      originConcreteLanguageTag: 'en-Latn-US',
      originTemplateGroup: 'en-Latn',
      replyLanguageTag: 'en-Latn-US',
      replyStateRevision: 1,
    })
    await expect(
      db
        .select({
          disposition: aiOperations.replyAdoptionDisposition,
          adoptedReplyRevision: aiOperations.adoptedReplyRevision,
          adoptedReviewReplyStateRevision: aiOperations.adoptedReviewReplyStateRevision,
        })
        .from(aiOperations)
        .where(eq(aiOperations.id, '74000000-0000-4000-8000-000000000004'))
        .limit(1),
    ).resolves.toEqual([
      {
        disposition: 'adopted',
        adoptedReplyRevision: 1,
        adoptedReviewReplyStateRevision: 1,
      },
    ])

    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken: token,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      reply: { stateRevision: 1 },
    })
  })

  it('rejects edited text, expiry, and stale source without changing the reply', async () => {
    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: `${SUGGESTION}!`,
        provenanceToken: provenanceToken({ baseReplyStateRevision: 1 }),
        now: NOW,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid' })

    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken: provenanceToken({
          baseReplyStateRevision: 1,
          tokenExpiresAtEpochMillis: NOW.getTime() - 1,
          draftExpiresAtEpochMillis: NOW.getTime() + 1,
        }),
        now: NOW,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'expired' })

    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken: provenanceToken({
          baseReplyStateRevision: 1,
          operationId: '74000000-0000-4000-8000-000000000006',
          sourceRevision: SOURCE_REVISION + 1,
        }),
        now: NOW,
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'stale' })
  })

  it('adopts a personalized draft without inventing stock-template provenance', async () => {
    const accepted = await store.accept({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      actorUserId: ACTOR_USER_ID,
      text: SUGGESTION,
      provenanceToken: personalizedProvenanceToken(),
      now: new Date(NOW.getTime() + 1),
    })

    expect(accepted).toMatchObject({
      status: 'accepted',
      reply: { aiGenerated: true, stateRevision: 2 },
    })
    if (accepted.status !== 'accepted') {
      throw new Error('Expected the fresh AI suggestion to be accepted')
    }
    await expect(
      db
        .select({
          profileVersion: replies.originAiProfileVersion,
          templateId: replies.originReplyTemplateId,
          catalogueVersion: replies.originReplyTemplateCatalogueVersion,
          catalogueDigest: replies.originReplyTemplateCatalogueDigest,
        })
        .from(replies)
        .where(eq(replies.id, accepted.reply.id))
        .limit(1),
    ).resolves.toEqual([
      {
        profileVersion: 'reply-draft-v1',
        templateId: null,
        catalogueVersion: null,
        catalogueDigest: null,
      },
    ])
    await expect(
      store.assertCurrentBinding({
        organizationId: ORGANIZATION_ID,
        replyId: accepted.reply.id,
      }),
    ).resolves.toBe('current')

    await expect(
      db
        .select({
          id: aiOperations.id,
          disposition: aiOperations.replyAdoptionDisposition,
          adoptedReplyRevision: aiOperations.adoptedReplyRevision,
          adoptedReviewReplyStateRevision: aiOperations.adoptedReviewReplyStateRevision,
        })
        .from(aiOperations)
        .where(
          sql`${aiOperations.id} IN (
            ${'74000000-0000-4000-8000-000000000004'}::uuid,
            ${'74000000-0000-4000-8000-000000000005'}::uuid
          )`,
        )
        .orderBy(aiOperations.id),
    ).resolves.toEqual([
      {
        id: '74000000-0000-4000-8000-000000000004',
        disposition: 'invalidated',
        adoptedReplyRevision: 1,
        adoptedReviewReplyStateRevision: 1,
      },
      {
        id: '74000000-0000-4000-8000-000000000005',
        disposition: 'adopted',
        adoptedReplyRevision: 2,
        adoptedReviewReplyStateRevision: 2,
      },
    ])
  })

  it('atomically invalidates a grounded suggestion when Portal says its Brand Profile changed', async () => {
    brandProfileCurrent = false
    const token = groundedProvenanceToken()

    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken: token,
        now: new Date(NOW.getTime() + 2),
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalidated' })
    expect(brandAuthorityCalls.at(-1)).toEqual({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      version: 7,
      displayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
    await expect(
      db
        .select({
          disposition: aiOperations.replyAdoptionDisposition,
          adoptedReplyRevision: aiOperations.adoptedReplyRevision,
          adoptedReviewReplyStateRevision: aiOperations.adoptedReviewReplyStateRevision,
        })
        .from(aiOperations)
        .where(eq(aiOperations.id, '74000000-0000-4000-8000-000000000007'))
        .limit(1),
    ).resolves.toEqual([
      {
        disposition: 'invalidated',
        adoptedReplyRevision: null,
        adoptedReviewReplyStateRevision: null,
      },
    ])

    brandProfileCurrent = true
    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken: token,
        now: new Date(NOW.getTime() + 3),
      }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalidated' })
  })

  it('keeps an adopted Review-owned draft usable after a later Brand Profile change', async () => {
    brandProfileCurrent = true
    const token = groundedProvenanceToken({
      operationId: '74000000-0000-4000-8000-000000000008',
    })
    const accepted = await store.accept({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      actorUserId: ACTOR_USER_ID,
      text: SUGGESTION,
      provenanceToken: token,
      now: new Date(NOW.getTime() + 4),
    })
    expect(accepted).toMatchObject({
      status: 'accepted',
      reply: { stateRevision: 3 },
    })
    if (accepted.status !== 'accepted') {
      throw new Error('Expected the grounded suggestion to be adopted')
    }

    const authorityCallCount = brandAuthorityCalls.length
    brandProfileCurrent = false
    await expect(
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: REVIEW_ID,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken: token,
        now: new Date(NOW.getTime() + 5),
      }),
    ).resolves.toMatchObject({ status: 'accepted', reply: { stateRevision: 3 } })
    expect(brandAuthorityCalls).toHaveLength(authorityCallCount)
    await expect(
      store.assertCurrentBinding({
        organizationId: ORGANIZATION_ID,
        replyId: accepted.reply.id,
      }),
    ).resolves.toBe('current')
    await expect(
      db
        .select({ disposition: aiOperations.replyAdoptionDisposition })
        .from(aiOperations)
        .where(eq(aiOperations.id, '74000000-0000-4000-8000-000000000008'))
        .limit(1),
    ).resolves.toEqual([{ disposition: 'adopted' }])
    brandProfileCurrent = true
  })

  it('purges an AI draft on source change and advances human-draft heads only for material changes', async () => {
    await db.transaction(async (tx) => {
      await tx
        .update(reviews)
        .set({ sourceRevision: SOURCE_REVISION + 1 })
        .where(eq(reviews.id, REVIEW_ID))
      await deleteAiDraftsForReview(tx, {
        organizationId: ORGANIZATION_ID,
        reviewId: REVIEW_ID,
      })
    })
    await expect(
      db
        .select({ replyStateRevision: reviews.replyStateRevision })
        .from(reviews)
        .where(eq(reviews.id, REVIEW_ID))
        .limit(1),
    ).resolves.toEqual([{ replyStateRevision: 4 }])
    await expect(
      db
        .select({
          disposition: aiOperations.replyAdoptionDisposition,
          adoptedReplyRevision: aiOperations.adoptedReplyRevision,
          adoptedReviewReplyStateRevision: aiOperations.adoptedReviewReplyStateRevision,
        })
        .from(aiOperations)
        .where(eq(aiOperations.id, '74000000-0000-4000-8000-000000000005'))
        .limit(1),
    ).resolves.toEqual([
      {
        disposition: 'invalidated',
        adoptedReplyRevision: 2,
        adoptedReviewReplyStateRevision: 2,
      },
    ])

    const [created] = await db
      .insert(replies)
      .values({
        reviewId: REVIEW_ID,
        organizationId: ORGANIZATION_ID,
        text: 'A manual draft',
        status: 'draft',
        source: 'internal',
        createdBy: ACTOR_USER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning({
        id: replies.id,
        authorship: replies.authorship,
        stateRevision: replies.stateRevision,
      })
    expect(created).toMatchObject({ authorship: 'human', stateRevision: 1 })

    await db
      .update(replies)
      .set({ updatedAt: new Date(NOW.getTime() + 1) })
      .where(eq(replies.id, created!.id))
    await expect(
      db
        .select({
          stateRevision: replies.stateRevision,
          replyStateRevision: reviews.replyStateRevision,
        })
        .from(replies)
        .innerJoin(reviews, eq(reviews.id, replies.reviewId))
        .where(eq(replies.id, created!.id))
        .limit(1),
    ).resolves.toEqual([{ stateRevision: 1, replyStateRevision: 5 }])

    await db
      .update(replies)
      .set({ text: 'A revised manual draft' })
      .where(eq(replies.id, created!.id))
    await expect(
      db
        .select({
          text: replies.text,
          stateRevision: replies.stateRevision,
          replyStateRevision: reviews.replyStateRevision,
        })
        .from(replies)
        .innerJoin(reviews, eq(reviews.id, replies.reviewId))
        .where(eq(replies.id, created!.id))
        .limit(1),
    ).resolves.toEqual([
      {
        text: 'A revised manual draft',
        stateRevision: 2,
        replyStateRevision: 6,
      },
    ])
  })
})
