import { generateKeyPairSync } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { createPropertyProcessingProfileAdapter } from '#/contexts/ai/analysis/property-processing-profile.adapter.server'
import type { Review } from '../domain/review-types'
import type { Database } from '#/shared/db'
import {
  aiExecutionControlHeads,
  aiExecutionControlTransitions,
  aiOperations,
  aiOrganizationCostWindows,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  properties,
  reviewAiAnalysisHeads,
} from '#/shared/db/schema'
import type { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { AI_PERSONALIZED_REPLY_PROFILE_DIGEST } from '#/shared/reply/ai-personalized-reply-contract'
import { AI_PERSONALIZED_REPLY_PROFILE_VERSION } from '#/shared/reply/ai-personalized-reply-profile'
import { AI_REPLY_TEMPLATE_CATALOGUE_DIGEST } from '#/shared/reply/ai-reply-template-catalogue'
import { digestAiReplyBrandDisplayName } from '#/shared/reply/ai-reply-brand-profile.server'
import {
  digestRenderedReply,
  signAiReplyProvenance,
  type AiReplyProvenancePayloadV1,
  type AiReplyProvenancePayloadV2,
  type AiReplyProvenancePayloadV3,
} from '#/shared/reply/ai-reply-provenance'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

export const BRAND_DISPLAY_NAME_DIGEST = digestAiReplyBrandDisplayName('Example Hotel')
export const LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST =
  '86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769' // gitleaks:allow

const DEFAULT_OPERATION_V1 = '74000000-0000-4000-8000-000000000004'
const DEFAULT_OPERATION_V2 = '74000000-0000-4000-8000-000000000005'
const DEFAULT_OPERATION_V3 = '74000000-0000-4000-8000-000000000007'
const UNSEEDED_PERMIT = '74000000-0000-4000-8000-0000000001ff'

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

export type ReplyExecutionState = 'enabled' | 'killed'
export type ReplyAdmissionState = 'accepting' | 'draining'

export type AiReplyAdoptionConfig = Readonly<{
  organizationId: ReturnType<typeof organizationId>
  propertyId: ReturnType<typeof propertyId>
  reviewId: ReturnType<typeof reviewId>
  actorUserId: ReturnType<typeof userId>
  lineageId: string
  sourceEpoch: number
  sourceRevision: number
  suggestion: string
  now: Date
  label: string
}>

export type SeedSucceededReplyOperationInput = Readonly<{
  operationId: string
  permitId: string
  sourceRevision: number
  baseReplyStateRevision: number
  reviewId?: string
  replyBrandProfileVersion?: number
  replyBrandDisplayNameDigest?: string
  executionAttempt?: number
}>

/**
 * Builders for suites that adopt a signed AI reply suggestion against real
 * PostgreSQL: an enabled Property, succeeded reply operations, provenance tokens
 * signed for them, and the reply-drafting execution control.
 */
export function createAiReplyAdoptionFixture(
  db: Database,
  config: AiReplyAdoptionConfig,
) {
  const { organizationId: orgId, propertyId: propId, actorUserId, now } = config
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')

  // The execution each seeded operation was delivered by; tokens name it.
  const seededExecutions = new Map<
    string,
    Readonly<{ executionPermitId: string; executionAttempt: number }>
  >()

  const executionOf = (operationId: string) =>
    seededExecutions.get(operationId) ?? {
      executionPermitId: UNSEEDED_PERMIT,
      executionAttempt: 1,
    }

  const sharedPayload = (operationId: string, baseReplyStateRevision: number) =>
    ({
      kid: 'provenance-v1',
      operationId,
      actorId: actorUserId,
      organizationId: orgId,
      propertyId: propId,
      reviewId: config.reviewId,
      ...executionOf(operationId),
      sourceEpoch: config.sourceEpoch,
      sourceRevision: config.sourceRevision,
      baseReplyStateRevision,
      replyDraftingEpoch: 1,
      propertyProfileVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      operationProfileVersion: 'reply-suggestion-v1',
      modelSnapshot: 'gpt-5.4-mini-2026-03-17',
      promptVersion: 'reply-suggestion-prompt-v1',
      outputLeakageProfileVersion: 'ai-output-leakage-v1',
      outputLeakageProfileDigest: 'a'.repeat(64),
      concreteLanguageTag: 'en-Latn-US',
      templateGroup: 'en-Latn',
      renderedSuggestionDigest: digestRenderedReply(config.suggestion),
      tokenExpiresAtEpochMillis: now.getTime() + 5 * 60_000,
      draftExpiresAtEpochMillis: now.getTime() + 30 * 60_000,
    }) as const

  const provenancePayload = (
    overrides: Partial<AiReplyProvenancePayloadV1> = {},
  ): AiReplyProvenancePayloadV1 => ({
    ...sharedPayload(overrides.operationId ?? DEFAULT_OPERATION_V1, 0),
    version: 'ai-reply-provenance-v1',
    replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
    replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
    templateId: 'appreciation_positive',
    ...overrides,
  })

  const provenanceToken = (overrides: Partial<AiReplyProvenancePayloadV1> = {}) =>
    signAiReplyProvenance(provenancePayload(overrides), privateKey)

  const personalizedProvenanceToken = (
    overrides: Partial<AiReplyProvenancePayloadV2> = {},
  ) =>
    signAiReplyProvenance(
      {
        ...sharedPayload(overrides.operationId ?? DEFAULT_OPERATION_V2, 1),
        version: 'ai-reply-provenance-v2',
        replyProfileVersion: 'reply-draft-v1',
        replyProfileDigest: LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST,
        ...overrides,
      },
      privateKey,
    )

  const groundedProvenanceToken = (overrides: Partial<AiReplyProvenancePayloadV3> = {}) =>
    signAiReplyProvenance(
      {
        ...sharedPayload(overrides.operationId ?? DEFAULT_OPERATION_V3, 2),
        version: 'ai-reply-provenance-v3',
        replyProfileVersion: AI_PERSONALIZED_REPLY_PROFILE_VERSION,
        replyProfileDigest: AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
        replyBrandProfileVersion: 7,
        replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
        replyVoiceDigest: 'f'.repeat(64),
        ...overrides,
      },
      privateKey,
    )

  /** A live Review in this suite's Property at the revision its operations bind. */
  const reviewFixture = (
    id: ReturnType<typeof reviewId>,
    externalId: string,
  ): Omit<Review, 'createdAt' | 'updatedAt'> => ({
    id,
    organizationId: orgId,
    propertyId: propId,
    platform: 'google',
    externalId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: 'A thoughtful review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: now,
    sourceUpdatedAt: now,
    firstFetchedAt: now,
    lastFetchedAt: now,
    contentExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    contentHash: 'd'.repeat(64),
    sourceSeenGeneration: null,
    sourceEpoch: config.sourceEpoch,
    sourceRevision: config.sourceRevision,
    analysisSequence: 11,
    aiSourceByteLength: 20,
    aiSourceDigest: 'e'.repeat(64),
  })

  const selectControl = async (scopeKey: string) => {
    const [head] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, scopeKey))
      .limit(1)
    return head
  }

  const transitionReplyControl = async (
    executionState: ReplyExecutionState,
    admissionState: ReplyAdmissionState,
  ) => {
    const head = await selectControl('capability:reply_drafting')
    if (!head) throw new Error('Reply drafting execution control is not seeded')
    if (
      head.executionState === executionState &&
      head.admissionState === admissionState
    ) {
      return
    }
    const occurredAt = now
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
        actorUserId,
        ticketReference: `${config.label}-${generation}`,
        candidateReleaseSha: null,
        occurredAt,
      })
      await tx
        .update(aiExecutionControlHeads)
        .set({ generation, executionState, admissionState, updatedAt: occurredAt })
        .where(
          sql`${aiExecutionControlHeads.scopeKey} = 'capability:reply_drafting'
            AND ${aiExecutionControlHeads.generation} = ${head.generation}`,
        )
    })
  }

  /** Reads the reply control's current state so a suite can restore it. */
  const readReplyControl = async (): Promise<{
    executionState: ReplyExecutionState
    admissionState: ReplyAdmissionState
  }> => {
    const head = await selectControl('capability:reply_drafting')
    if (!head) throw new Error('Reply drafting execution control is not seeded')
    if (
      (head.executionState !== 'enabled' && head.executionState !== 'killed') ||
      (head.admissionState !== 'accepting' && head.admissionState !== 'draining')
    ) {
      throw new Error('Reply drafting execution control has an invalid state')
    }
    return {
      executionState: head.executionState,
      admissionState: head.admissionState,
    }
  }

  const seedSucceededReplyOperation = async (input: SeedSucceededReplyOperationInput) => {
    const globalControl = await selectControl('global')
    const providerControl = await selectControl('provider:private-beta-global-v2')
    const capabilityControl = await selectControl('capability:reply_drafting')
    if (!globalControl || !providerControl || !capabilityControl) {
      throw new Error('AI execution controls are not seeded')
    }
    seededExecutions.set(input.operationId, {
      executionPermitId: input.permitId,
      executionAttempt: input.executionAttempt ?? 1,
    })
    const createdAt = new Date(now.getTime() - 60_000)
    const expiresAt = new Date(now.getTime() + 60 * 60_000)
    await db
      .insert(aiOrganizationCostWindows)
      .values({
        id: input.permitId,
        organizationId: orgId,
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
      organizationId: orgId,
      propertyId: propId,
      actorUserId,
      systemPrincipal: null,
      reviewId: input.reviewId ?? config.reviewId,
      sourceEpoch: config.sourceEpoch,
      sourceRevision: input.sourceRevision,
      reviewedAtEpochMillis: now.getTime(),
      tone: 'professional',
      baseReplyStateRevision: input.baseReplyStateRevision,
      authorizationLineageId: config.lineageId,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
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
      costWindowId: input.permitId,
      reservedMicros: 50_000,
      actualMicros: 42,
      budgetReservedAt: createdAt,
      budgetSettledAt: now,
      state: 'succeeded',
      executionAttempt: input.executionAttempt ?? 1,
      createdAt,
      updatedAt: now,
      expiresAt,
      deliveredAt: now,
    })
  }

  /** Removes everything the fixture's organization owns, Replies first. */
  const clear = async () => {
    // Replies deliberately restrict Review deletion; remove test-owned child
    // rows before the Property cascade reaches the stable Review.
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${orgId}`)
    await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${orgId}`)
    await db
      .delete(aiOrganizationCostWindows)
      .where(eq(aiOrganizationCostWindows.organizationId, orgId))
    await db.delete(properties).where(eq(properties.id, propId))
    await deleteTestOrganizations(db, [orgId])
  }

  /** Seeds the Organization, Property, analysis head, profile and reply-drafting consent. */
  const seedEnabledProperty = async (input: Readonly<{ propertySlug: string }>) => {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${orgId}, ${`AI ${config.label} test`}, ${orgId}, ${now})
    `)
    await db.insert(properties).values({
      id: propId,
      organizationId: orgId,
      name: `AI ${config.label} property`,
      slug: input.propertySlug,
      timezone: 'America/New_York',
      countryCode: 'US',
      profileVersion: 3,
      sourceEpoch: config.sourceEpoch,
    })
    await db.insert(reviewAiAnalysisHeads).values({
      organizationId: orgId,
      propertyId: propId,
      sourceEpoch: config.sourceEpoch,
      headSequence: 11,
      createdAt: now,
      updatedAt: now,
    })
    const profiles = createPropertyProcessingProfileAdapter(
      db,
      () => now,
      replyScopeEffects,
    )
    const refreshed = await profiles.refreshForAi({
      organizationId: orgId,
      propertyId: propId,
    })
    if (refreshed.status !== 'available' || refreshed.profile.profileVersion !== 1) {
      throw new Error('Expected the Property processing profile at version 1')
    }

    const capabilityRuntimeProfileVersions = {
      reply_drafting: 'reply-drafting-runtime-v1',
    } as const
    const consent = {
      organizationId: orgId,
      propertyId: propId,
      authorizationLineageId: config.lineageId,
      state: 'enabled',
      capabilities: ['reply_drafting' as const],
      capabilityRuntimeProfileVersions,
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      authorizedSourceEpoch: config.sourceEpoch,
      analysisStartSequence: 11,
      stateVersion: 1,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      ...CONSENT_CONTRACT_FACTS,
      providerDeploymentProfileVersion: 'private-beta-global-v2',
      redactionProfileFamily: 'gbp-review-global-v1',
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      await tx.insert(merchantAiConsentEvidence).values({
        ...consent,
        transitionKind: 'enable',
        actorUserId,
        reasonCode: 'merchant_enabled',
        idempotencyKey: `ai-${config.label}-enable-v1`,
        requestHash: 'c'.repeat(64),
        occurredAt: now,
      })
      await tx.insert(merchantAiEnablement).values({
        ...consent,
        updatedBy: actorUserId,
        updatedAt: now,
      })
    })
  }

  return {
    privateKey,
    publicKey,
    executionOf,
    provenancePayload,
    provenanceToken,
    personalizedProvenanceToken,
    groundedProvenanceToken,
    reviewFixture,
    transitionReplyControl,
    readReplyControl,
    seedSucceededReplyOperation,
    seedEnabledProperty,
    clear,
  }
}
