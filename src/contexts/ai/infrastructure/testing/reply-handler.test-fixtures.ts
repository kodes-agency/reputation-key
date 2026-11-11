import type { ReplySuggestionSourceInput } from '#/contexts/ai/application/ports/ai-inference.port'
import type { AiOperationId } from '#/contexts/ai/domain/types'
import {
  createAiHandlerHarness,
  useAiHandlerDatabase,
} from '#/contexts/ai/infrastructure/testing/handler-harness.test-fixtures'
import type { GenerateReplySuggestionDependencies } from '#/contexts/ai/reply/generate-suggestion.server'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { parseCanonicalReplyLanguageTag } from '#/shared/ai-review-language-catalogue'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { vi } from 'vitest'
const handlerDatabase = useAiHandlerDatabase()
vi.mock('#/shared/ai-review-language-catalogue', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/ai-review-language-catalogue')>()
  return {
    ...actual,
    mapReviewLanguageMetadata: vi.fn((metadata: string | null | undefined) => ({
      status: 'supported' as const,
      language:
        metadata === null || metadata === undefined
          ? { tag: 'und' as const, group: 'und' as const }
          : { tag: 'en-Latn', group: 'en-Latn' },
    })),
  }
})

import { createGenerateReplySuggestion } from '#/contexts/ai/reply/generate-suggestion.server'

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-reply-workflow-test')
const PROPERTY_ID = propertyId('72000000-0000-4000-8000-000000000101')
const REVIEW_ID = reviewId('72000000-0000-4000-8000-000000000102')
const ACTOR_USER_ID = userId('72000000-0000-4000-8000-000000000103')
const OPERATION_ID = '72000000-0000-4000-8000-000000000104' as AiOperationId
const PERMIT_ID = '72000000-0000-4000-8000-000000000105'
const LINEAGE_ID = '72000000-0000-4000-8000-000000000106'
const SHA = 'a'.repeat(64)
const BRAND_DISPLAY_NAME_DIGEST =
  '030c644bf71ad1d7570dc9ab6131f5209ac02fa65e930e2910778e024fc643bf'

const INPUT = Object.freeze({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  actorUserId: ACTOR_USER_ID,
  tone: 'professional' as const,
  targetLanguage: { kind: 'review_language' as const },
  idempotencyKey: 'reply-suggestion-test-key',
  expectedSourceEpoch: 2,
  expectedSourceRevision: 5,
  expectedBaseReplyStateRevision: 3,
})

const DEFAULT_IDENTITY = {
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  operationId: OPERATION_ID,
  permitId: PERMIT_ID,
  lineageId: LINEAGE_ID,
}

async function createHarness(
  options: Readonly<{
    authorization?: 'absent'
    identity?: typeof DEFAULT_IDENTITY
    currentReplyStateRevision?: number
    reviewText?: string | null
    rating?: 1 | 2 | 3 | 4 | 5
    reviewLanguageCode?: string | null
    replyLanguage?: Readonly<{
      status: string
      language?: ReturnType<typeof parseCanonicalReplyLanguageTag>
      reason?: string
    }>
    propertyReplyLanguage?: string | null
    brandProfile?: Readonly<{
      displayName: string
      version: number
      displayNameDigest: string
    }> | null
    brandProfileAfterProvider?: Readonly<{
      displayName: string
      version: number
      displayNameDigest: string
    }> | null
    brandProfileAfterSettlement?: Readonly<{
      displayName: string
      version: number
      displayNameDigest: string
    }> | null
    settleEphemeralReplyResult?: boolean
    assertCurrentStatus?: 'current' | 'stale'
    /** The interactive lane is full until this instant. */
    admissionBusyUntil?: number
    /** The first admission answers busy until this instant; later ones admit. */
    admissionBusyOnceUntil?: number
    sleep?: (milliseconds: number) => Promise<void>
    gatewayErrorCode?:
      | 'provider_unavailable'
      | 'provider_rate_limited'
      | 'provider_refused'
      | 'output_invalid'
      | 'output_truncated'
      | 'completed_without_delivery'
      | 'operation_ambiguous'
      | 'source_revision_changed'
      | 'capability_epoch_changed'
    /** The notice the Property's consent was recorded under. Defaults to the served one. */
    consentNotice?: Readonly<{ noticeVersion: string; noticeDigest: string }>
    /**
     * Run the gateway's own request check on what the use case sends, as the
     * in-process inference adapter does before anything else.
     */
    checksGatewayRequest?: boolean
    replyLocalFrame?: null | Readonly<{
      prefix: string
      suffix: string
      voiceDigest: string
      reviewerDisplayName: string | null
      contact: string | null
      signerName: string | null
      signerTitle: string | null
      businessName: string
    }>
  }> = {},
) {
  const {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    reviewId: REVIEW_ID,
    operationId: OPERATION_ID,
    permitId: PERMIT_ID,
    lineageId: LINEAGE_ID,
  } = options.identity ?? DEFAULT_IDENTITY
  let admissionCalls = 0
  const currentReplyStateRevision = options.currentReplyStateRevision ?? 3
  const initialBrandProfile =
    options.brandProfile === undefined
      ? {
          displayName: 'Example Hotel',
          version: 7,
          displayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
        }
      : options.brandProfile
  const brandProfileAfterProvider =
    options.brandProfileAfterProvider === undefined
      ? initialBrandProfile
      : options.brandProfileAfterProvider
  const brandProfileAfterSettlement =
    options.brandProfileAfterSettlement === undefined
      ? brandProfileAfterProvider
      : options.brandProfileAfterSettlement
  let brandProfileReadCount = 0
  let settlementAttempted = false
  const readCurrentAiReplyBrandProfile = vi.fn(async () => {
    brandProfileReadCount += 1
    return brandProfileReadCount === 1
      ? initialBrandProfile
      : settlementAttempted
        ? brandProfileAfterSettlement
        : brandProfileAfterProvider
  })
  const persistence = await createAiHandlerHarness(handlerDatabase(), {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    operationId: OPERATION_ID,
    permitId: PERMIT_ID,
    lineageId: LINEAGE_ID,
    now: NOW,
    capability: 'reply_drafting',
    authorization: options.authorization,
    consentNotice:
      options.consentNotice?.noticeDigest === SHA ? undefined : options.consentNotice,
  })
  // Inconsistent notice digests cannot be stored. Keep this defensive port
  // contract check distinct from the persisted consent scenarios.
  if (options.consentNotice?.noticeDigest === SHA) {
    const authorization = await persistence.readAuthorization()
    persistence.authorization.readMerchantAuthorization.mockResolvedValue({
      ...authorization!,
      ...options.consentNotice,
    })
  }
  if (options.authorization !== 'absent')
    for (let epoch = 2; epoch <= 7; epoch++)
      await persistence.grant({
        capabilityEpochs: {
          review_analysis: { epoch: 1, changedAtEpochMillis: NOW },
          reply_drafting: { epoch, changedAtEpochMillis: NOW },
          property_trends: { epoch: 1, changedAtEpochMillis: NOW },
        },
      })
  const { claim, claimExecution, markDelivered } = persistence.operations
  const generateReply = vi.fn(async (request: ReplySuggestionSourceInput) => {
    const admission = await persistence.settleProviderOperation(request.operationId)
    if (!admission.ok)
      return {
        route: 'reply-suggestion' as const,
        status: 'error' as const,
        code: 'quota_exhausted' as const,
        retryAfterEpochMillis: null,
      }
    if (options.checksGatewayRequest) parseAiGatewayRouteRequest(request)
    return options.gatewayErrorCode
      ? ({
          route: 'reply-suggestion' as const,
          status: 'error' as const,
          code: options.gatewayErrorCode,
          retryAfterEpochMillis: null,
        } as const)
      : ({
          route: 'reply-suggestion' as const,
          status: 'success' as const,
          result: {
            profileVersion: 'reply-draft-v3' as const,
            replyText: 'Thank you for your thoughtful review.',
            provenanceToken: 'signed-provenance-token',
            expiresAtEpochMillis: NOW + 5 * 60_000,
            baseReplyStateRevision: 3,
            concreteLanguageTag: 'en-Latn',
            templateGroup: 'en-Latn' as const,
          },
          settlementReceipt: {
            version: 'ai-settlement-receipt-v1' as const,

            grantKid: 'grant-v1',
            operationId: request.operationId,
            permitId: request.permitId,
            attemptNumber: request.attemptNumber,
            nonce: 'AQIDBA',
            requestBindingHmac: 'A'.repeat(43),
            disposition: 'success' as const,
            reportedDisposition: 'success' as const,
            providerRetryable: false,
            usageKnown: true,
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            reasoningTokens: 0,
            costMicros: 42,
            settledAtEpochMillis: NOW + 1_000,
            settlementState: 'settled' as const,
          },
        } as const)
  })
  const settleEphemeralReply = vi.fn(
    async (
      input: Parameters<
        GenerateReplySuggestionDependencies['outputs']['settleEphemeralReply']
      >[0],
    ) => {
      settlementAttempted = true
      if (options.settleEphemeralReplyResult === false) return false
      await persistence.patchOperation(
        { state: 'succeeded_pending_delivery' },
        input.operationId,
      )
      return true
    },
  )
  const release = vi.fn(async () => {})
  const readReplyStateRevision = vi.fn(async () => currentReplyStateRevision)

  const dependencies = {
    authorization: persistence.authorization,
    control: persistence.control,
    inference: {
      analyzeReview: vi.fn(),
      generateReply,
      generateTrend: vi.fn(),
    },
    operations: persistence.operations,
    outputs: {
      storeAnalysis: vi.fn(),
      settleEphemeralReply,
      findCurrentReviewIdsByAttention: vi.fn(),
      readAnalysisForDelivery: vi.fn(),
    },
    admission: {
      acquire: vi.fn(async () => {
        const busyUntil =
          options.admissionBusyUntil ??
          (admissionCalls++ === 0 ? options.admissionBusyOnceUntil : undefined)
        return busyUntil === undefined
          ? {
              ok: true as const,
              admissionId: 'admission-1',
              expiresAtEpochMillis: NOW + 90_000,
            }
          : {
              ok: false as const,
              code: 'admission_busy' as const,
              retryAfterEpochMillis: busyUntil,
            }
      }),
      release,
    },
    ...(options.sleep ? { sleep: options.sleep } : {}),
    reviewSources: {
      readForAi: vi.fn(async () => ({
        status: 'available' as const,
        observation: {
          kind: 'review' as const,
          reviewId: REVIEW_ID,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          text:
            options.reviewText === undefined
              ? 'A thoughtful review.'
              : options.reviewText,
          rating: options.rating ?? (5 as const),
          languageCode:
            options.reviewLanguageCode === undefined
              ? 'en-US'
              : options.reviewLanguageCode,
          reviewedAtEpochMillis: NOW - 1_000,
          contentExpiresAtEpochMillis: NOW + 60_000,
          sourceEpoch: 2,
          sourceRevision: 5,
          analysisSequence: 1,
        },
      })),
      hasCurrentReply: vi.fn(async () => false),
      readReplyStateRevision,
      assertCurrent: vi.fn(async () => ({
        status: options.assertCurrentStatus ?? ('current' as const),
      })),
    },
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available' as const,
        profile: {
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          countryCode: 'US',
          timezone: 'America/New_York',
          processingRegion: 'global' as const,
          routingPolicyVersion: 1,
          sourceEpoch: 2,
          profileVersion: 3,
          lifecycleState: 'active' as const,
        },
      })),
      refreshForAi: vi.fn(),
    },
    propertyReplyLanguages: {
      readDefaultReplyLanguage: vi.fn(async () => options.propertyReplyLanguage ?? null),
    },
    replyBrandProfiles: { readCurrentAiReplyBrandProfile },
    ...(options.replyLocalFrame === undefined
      ? {}
      : {
          replyVoices: {
            resolveLocalFrame: vi.fn(async () => options.replyLocalFrame ?? null),
          },
        }),
    resolveReplyLanguage: vi.fn(
      async () =>
        options.replyLanguage ?? {
          status: 'resolved',
          language: parseCanonicalReplyLanguageTag('en-Latn'),
        },
    ),
    nowEpochMillis: () => NOW,
  } as unknown as GenerateReplySuggestionDependencies

  return {
    persistence,
    dependencies,
    generate: createGenerateReplySuggestion(dependencies),
    mocks: {
      readMerchantAuthorization: dependencies.authorization.readMerchantAuthorization,
      readProcessingProfile: dependencies.processingProfiles.readForAi,
      claim,
      claimExecution,
      readHeads: dependencies.control.readHeads,
      acquire: dependencies.admission.acquire,
      generateReply,
      settleEphemeralReply,
      markDelivered,
      release,
      hasCurrentReply: vi.fn(async () => false),
      readReplyStateRevision,
      readDefaultReplyLanguage:
        dependencies.propertyReplyLanguages.readDefaultReplyLanguage,
      resolveReplyLanguage: dependencies.resolveReplyLanguage,
      readCurrentAiReplyBrandProfile,
      recordFailure: dependencies.operations.recordFailure,
    },
  }
}

export {
  ACTOR_USER_ID,
  BRAND_DISPLAY_NAME_DIGEST,
  createHarness,
  INPUT,
  LINEAGE_ID,
  NOW,
  OPERATION_ID,
  ORGANIZATION_ID,
  PROPERTY_ID,
  REVIEW_ID,
  SHA,
}
