import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  mapReviewLanguageMetadata,
  parseCanonicalReplyLanguageTag,
} from '#/shared/ai-review-language-catalogue'
import { AI_SOURCE_CANONICALIZER_PROFILE_V1 } from '#/shared/ai-operation-profiles'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '#/shared/ai-reply-template-catalogue'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import { encodeCanonicalAiReviewSource } from '#/shared/ai-review-source-contract'
import type { AiOperationId } from '../../domain/types'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiOperationState,
  AiOperationStorePort,
} from '../ports/ai-operation-store.port'
import { aiRequestFingerprint, aiReviewSourceProvenance } from '../ai-workflow-support'
import type { GenerateReplySuggestionDependencies } from './generate-reply-suggestion'
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

import { createGenerateReplySuggestion } from './generate-reply-suggestion'

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

function createHarness(
  options: Readonly<{
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
  }> = {},
) {
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
  const claim = vi.fn(
    async (request: {
      identity: unknown
      binding: unknown
      nowEpochMillis: number
      expiresAtEpochMillis: number
      idempotencyKey: string
      requestFingerprint: string
      sourceProvenance: unknown
    }) => ({
      status: 'created' as const,
      operation: {
        id: OPERATION_ID,
        identity: request.identity,
        binding: request.binding,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: request.requestFingerprint,
        sourceProvenance: request.sourceProvenance,
        state: 'pending' as const,
        executionAttempt: 0,
        executionPermitId: null,
        nextAttemptAtEpochMillis: null,
        failureCode: null,
        createdAtEpochMillis: request.nowEpochMillis,
        updatedAtEpochMillis: request.nowEpochMillis,
        expiresAtEpochMillis: request.expiresAtEpochMillis,
      },
    }),
  )
  const claimExecution = vi.fn(async () => {
    const firstClaim = claim.mock.results[0]
    if (firstClaim === undefined) throw new Error('operation was not claimed')
    const claimed = await firstClaim.value
    return {
      ...claimed.operation,
      state: 'executing' as const,
      executionAttempt: 1,
      executionPermitId: PERMIT_ID,
    }
  })
  const generateReply = vi.fn(async () =>
    options.gatewayErrorCode
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
            profileVersion: 'reply-draft-v2' as const,
            replyText: 'Thank you for your thoughtful review.',
            provenanceToken: 'signed-provenance-token',
            expiresAtEpochMillis: NOW + 5 * 60_000,
            baseReplyStateRevision: 3,
            concreteLanguageTag: 'en-Latn',
            templateGroup: 'en-Latn' as const,
          },
          settlementReceipt: {
            version: 'ai-settlement-receipt-v1' as const,
            receiptKid: 'receipt-v1',
            grantKid: 'grant-v1',
            operationId: OPERATION_ID,
            permitId: PERMIT_ID,
            attemptNumber: 1,
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
            receiptSignature: 'A'.repeat(86),
          },
        } as const),
  )
  const settleEphemeralReply = vi.fn(async () => {
    settlementAttempted = true
    return options.settleEphemeralReplyResult ?? true
  })
  const markDelivered = vi.fn(async () => true)
  const release = vi.fn(async () => {})
  const readReplyStateRevision = vi.fn(async () => currentReplyStateRevision)

  const dependencies = {
    authorization: {
      readMerchantAuthorization: vi.fn(async () => ({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        state: 'enabled' as const,
        stateVersion: 1,
        authorizationLineageId: LINEAGE_ID,
        authorizedSourceEpoch: 2,
        capabilities: ['reply_drafting'] as const,
        capabilityRuntimeProfileVersions: {
          reply_drafting: 'reply-drafting-runtime-v1',
        },
        capabilityEpochs: {
          review_analysis: { epoch: 1, changedAtEpochMillis: NOW },
          reply_drafting: { epoch: 7, changedAtEpochMillis: NOW },
          property_trends: { epoch: 1, changedAtEpochMillis: NOW },
        },
        reviewAnalysisStartSequence: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: SHA,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        sourceCanonicalizerDigest: SHA,
        redactionProfileFamily: 'gbp-review-global-v1',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      })),
    },
    control: {
      readHeads: vi.fn(async () => [
        {
          scope: { kind: 'global' as const },
          controlId: '72000000-0000-4000-8000-000000000111',
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        },
        {
          scope: {
            kind: 'provider_deployment_profile' as const,
            providerDeploymentProfileVersion: 'private-beta-global-v1',
          },
          controlId: '72000000-0000-4000-8000-000000000112',
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        },
        {
          scope: { kind: 'capability' as const, capability: 'reply_drafting' as const },
          controlId: '72000000-0000-4000-8000-000000000113',
          generation: 1,
          executionState: 'enabled' as const,
          admissionState: 'accepting' as const,
          updatedAtEpochMillis: NOW,
        },
      ]),
      transition: vi.fn(),
    },
    inference: {
      analyzeReview: vi.fn(),
      generateReply,
      generateTrend: vi.fn(),
    },
    operations: {
      claim,
      claimExecution,
      recordFailure: vi.fn(async () => true),
      markDelivered,
    },
    outputs: {
      storeAnalysis: vi.fn(),
      settleEphemeralReply,
      findCurrentReviewIdsByAttention: vi.fn(),
      storeTrendReport: vi.fn(),
      readAnalysisForDelivery: vi.fn(),
      readTrendReportForDelivery: vi.fn(),
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
      readReplyStateRevision,
      readDefaultReplyLanguage:
        dependencies.propertyReplyLanguages.readDefaultReplyLanguage,
      resolveReplyLanguage: dependencies.resolveReplyLanguage,
      readCurrentAiReplyBrandProfile,
      recordFailure: dependencies.operations.recordFailure,
    },
  }
}
function expectNoAiExecution(...mocks: readonly unknown[]): void {
  for (const mock of mocks) expect(mock).not.toHaveBeenCalled()
}

describe('generate reply suggestion', () => {
  it('rejects a stale browser base revision before claiming an operation', async () => {
    const harness = createHarness({ currentReplyStateRevision: 4 })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'source_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.claim).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })

  it('loads a property-language template for a textless review without AI execution', async () => {
    const harness = createHarness({
      reviewText: null,
      propertyReplyLanguage: 'bg-Cyrl-BG',
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'no_review_text',
      languageSource: 'property_default',
      replyText:
        'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
    expect(harness.mocks.resolveReplyLanguage).not.toHaveBeenCalled()
    expectNoAiExecution(
      harness.mocks.readMerchantAuthorization,
      harness.mocks.readProcessingProfile,
      harness.mocks.readCurrentAiReplyBrandProfile,
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.claimExecution,
      harness.mocks.recordFailure,
      harness.mocks.acquire,
      harness.mocks.release,
      harness.mocks.generateReply,
      harness.mocks.settleEphemeralReply,
      harness.mocks.markDelivered,
    )
  })
  it('serves an explicit catalogue request without merchant AI admission or execution', async () => {
    const harness = createHarness({ propertyReplyLanguage: 'en-Latn' })

    await expect(
      harness.generate({
        ...INPUT,
        targetLanguage: { kind: 'property_default' },
        templateOnly: true,
      }),
    ).resolves.toMatchObject({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'template_requested',
      languageSource: 'explicit',
    })
    expectNoAiExecution(
      harness.mocks.readMerchantAuthorization,
      harness.mocks.readProcessingProfile,
      harness.mocks.readCurrentAiReplyBrandProfile,
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.claimExecution,
      harness.mocks.recordFailure,
      harness.mocks.acquire,
      harness.mocks.release,
      harness.mocks.generateReply,
      harness.mocks.settleEphemeralReply,
      harness.mocks.markDelivered,
    )
  })
  it.each([
    [
      4,
      'Thank you for sharing this positive review. We are pleased that your experience was enjoyable.',
    ],
    [
      3,
      'Thank you for sharing your perspective. We appreciate the time you took to describe your experience.',
    ],
    [
      2,
      'Thank you for explaining your concerns. We recognize that this experience was disappointing.',
    ],
    [
      1,
      'We are sorry that the service did not meet expectations. Your feedback is important to our team.',
    ],
  ] as const)('selects the rating-%i catalogue intent', async (rating, replyText) => {
    const harness = createHarness({
      reviewText: null,
      rating,
      propertyReplyLanguage: 'en-Latn',
    })

    await expect(
      harness.generate({
        ...INPUT,
        targetLanguage: { kind: 'property_default' },
      }),
    ).resolves.toMatchObject({
      status: 'fallback',
      reason: 'no_review_text',
      languageSource: 'explicit',
      replyText,
    })
  })

  it('fails closed before admission when the Property Brand Profile is unavailable', async () => {
    const harness = createHarness({ brandProfile: null })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'brand_profile_unavailable',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.claim).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })

  it.each([
    {
      targetLanguage: { kind: 'review_language' } as const,
      languageSource: 'property_default',
    },
    {
      targetLanguage: { kind: 'property_default' } as const,
      languageSource: 'explicit',
    },
  ])(
    'loads a chosen-language template for undetectable text ($languageSource)',
    async ({ targetLanguage, languageSource }) => {
      const harness = createHarness({
        reviewText: 'Nice',
        propertyReplyLanguage: 'bg-Cyrl-BG',
        replyLanguage: {
          status: 'language_not_supported',
          reason: 'insufficient_language_evidence',
        },
      })

      await expect(harness.generate({ ...INPUT, targetLanguage })).resolves.toEqual({
        status: 'fallback',
        kind: 'local_safe_template',
        reason: 'language_undetermined',
        languageSource,
        replyText:
          'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.',
        concreteLanguageTag: 'bg-Cyrl-BG',
      })
      expectNoAiExecution(
        harness.mocks.readMerchantAuthorization,
        harness.mocks.readProcessingProfile,
        harness.mocks.readCurrentAiReplyBrandProfile,
        harness.mocks.readHeads,
        harness.mocks.claim,
        harness.mocks.claimExecution,
        harness.mocks.recordFailure,
        harness.mocks.acquire,
        harness.mocks.release,
        harness.mocks.generateReply,
        harness.mocks.settleEphemeralReply,
        harness.mocks.markDelivered,
      )
    },
  )

  it('returns the existing target-language refusal when no default can resolve undetectable text', async () => {
    const harness = createHarness({
      reviewText: 'Nice',
      replyLanguage: {
        status: 'language_not_supported',
        reason: 'insufficient_language_evidence',
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'target_language_unavailable',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.claimExecution,
      harness.mocks.acquire,
      harness.mocks.generateReply,
    )
  })

  it('keeps a metadata mismatch unavailable', async () => {
    const harness = createHarness({
      replyLanguage: {
        status: 'language_not_supported',
        reason: 'metadata_language_mismatch',
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'language_not_supported',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })

  it('binds settlement and delivery to the current durable reply head', async () => {
    const harness = createHarness()

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'ready',
      profileVersion: 'reply-draft-v2',
      replyText: 'Thank you for your thoughtful review.',
      provenanceToken: 'signed-provenance-token',
      expiresAtEpochMillis: NOW + 5 * 60_000,
      baseReplyStateRevision: 3,
      concreteLanguageTag: 'en-Latn',
    })
    expect(harness.mocks.readReplyStateRevision).toHaveBeenCalledTimes(2)
    expect(harness.mocks.settleEphemeralReply).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: REVIEW_ID,
        baseReplyStateRevision: 3,
        replyDraftingEpoch: 7,
        operationProfileVersion: 'reply-suggestion-v1',
        replyProfileVersion: 'reply-draft-v2',
      }),
    )
    expect(harness.mocks.markDelivered).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      organizationId: ORGANIZATION_ID,
      expectedAttempt: 1,
      deliveredAtEpochMillis: NOW,
    })
    expect(harness.mocks.release).toHaveBeenCalledWith({ admissionId: 'admission-1' })
    expect(harness.mocks.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        replyProfileVersion: 'reply-draft-v2',
        brandProfile: { displayName: 'Example Hotel' },
        binding: expect.objectContaining({
          replyBrandProfileVersion: 7,
          replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
        }),
      }),
      expect.any(AbortSignal),
    )
    expect(harness.mocks.readCurrentAiReplyBrandProfile).toHaveBeenCalledTimes(2)
  })

  it('answers busy from a full interactive lane without claiming an attempt', async () => {
    const harness = createHarness({ admissionBusyUntil: NOW + 12_000 })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'busy',
      retryAfterEpochMillis: NOW + 12_000,
    })
    expect(harness.mocks.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'interactive', propertyId: PROPERTY_ID }),
    )
    expect(harness.mocks.claimExecution).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
    expect(harness.mocks.release).not.toHaveBeenCalled()
  })

  it('withholds a provider result when the public Brand Profile changes in flight', async () => {
    const harness = createHarness({
      brandProfileAfterProvider: {
        displayName: 'Example Hotel Sofia',
        version: 8,
        displayNameDigest: 'b'.repeat(64),
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'brand_profile_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.settleEphemeralReply).not.toHaveBeenCalled()
    expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
  })

  it('reports a Brand change that races the atomic settlement fence', async () => {
    const harness = createHarness({
      settleEphemeralReplyResult: false,
      brandProfileAfterSettlement: {
        displayName: 'Example Hotel Sofia',
        version: 8,
        displayNameDigest: 'b'.repeat(64),
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'brand_profile_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.settleEphemeralReply).toHaveBeenCalledTimes(1)
    expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
  })

  it.each([
    'provider_unavailable',
    'provider_rate_limited',
    'provider_refused',
    'output_invalid',
    'output_truncated',
  ] as const)(
    'reports %s as unavailable instead of substituting a template',
    async (gatewayErrorCode) => {
      const harness = createHarness({ gatewayErrorCode })

      const result = await harness.generate(INPUT)

      expect(result).toMatchObject({
        status: 'unavailable',
        code: 'provider_unavailable',
      })
      expect(harness.mocks.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ failureCode: gatewayErrorCode, expectedAttempt: 1 }),
      )
      expect(harness.mocks.settleEphemeralReply).not.toHaveBeenCalled()
      expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
      expect(harness.mocks.release).toHaveBeenCalledWith({ admissionId: 'admission-1' })
    },
  )

  it('waits briefly for an interactive slot that frees within the request', async () => {
    const sleep = vi.fn(async () => {})
    const harness = createHarness({ admissionBusyOnceUntil: NOW + 1_500, sleep })

    await expect(harness.generate(INPUT)).resolves.toMatchObject({ status: 'ready' })
    expect(sleep).toHaveBeenCalledWith(1_500)
    expect(harness.mocks.acquire).toHaveBeenCalledTimes(2)
    expect(harness.mocks.claimExecution).toHaveBeenCalledOnce()
  })

  it('answers busy without waiting when the slot frees after the wait allows', async () => {
    const sleep = vi.fn(async () => {})
    const harness = createHarness({ admissionBusyUntil: NOW + 30_000, sleep })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'busy',
      retryAfterEpochMillis: NOW + 30_000,
    })
    expect(sleep).not.toHaveBeenCalled()
    expect(harness.mocks.acquire).toHaveBeenCalledOnce()
  })

  it('resolves a property-default target from tenant-scoped server data', async () => {
    const harness = createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })

    await expect(
      harness.generate({
        ...INPUT,
        targetLanguage: { kind: 'property_default' },
      }),
    ).resolves.toMatchObject({
      status: 'ready',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
    expect(harness.mocks.readDefaultReplyLanguage).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })
    expect(harness.mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          concreteReplyLanguage: {
            tag: 'bg-Cyrl-BG',
            templateGroup: 'bg-Cyrl',
          },
        }),
      }),
    )
    expect(harness.mocks.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          concreteReplyLanguage: {
            tag: 'bg-Cyrl-BG',
            templateGroup: 'bg-Cyrl',
          },
        }),
      }),
      expect.any(AbortSignal),
    )
  })

  it.each([null, 'bg', 'en-Latn-INVALID'])(
    'fails closed when the property default target is unavailable (%s)',
    async (propertyReplyLanguage) => {
      const harness = createHarness({ propertyReplyLanguage })

      await expect(
        harness.generate({
          ...INPUT,
          targetLanguage: { kind: 'property_default' },
        }),
      ).resolves.toEqual({
        status: 'unavailable',
        code: 'target_language_unavailable',
        retryAfterEpochMillis: null,
      })
      expect(harness.mocks.claim).not.toHaveBeenCalled()
      expect(harness.mocks.generateReply).not.toHaveBeenCalled()
    },
  )

  it('does not consult the property default for a review-language target', async () => {
    const harness = createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })

    await harness.generate(INPUT)

    expect(harness.mocks.readDefaultReplyLanguage).not.toHaveBeenCalled()
    expect(harness.mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({
          concreteReplyLanguage: {
            tag: 'en-Latn',
            templateGroup: 'en-Latn',
          },
        }),
      }),
    )
  })

  it('uses the catalogue when a resolved language has no personalized profile', async () => {
    const text =
      'Bulgaristan’da nadir görülen konforlu bir mekan ve konaklamada sabah kahvaltısı dahil.'
    const harness = createHarness({
      reviewText: text,
      reviewLanguageCode: null,
      replyLanguage: {
        status: 'resolved',
        language: parseCanonicalReplyLanguageTag('tr-Latn'),
      },
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'language_not_personalized',
      languageSource: 'explicit',
      replyText:
        'Bu olumlu değerlendirmeyi paylaştığınız için teşekkür ederiz. Deneyiminizin keyifli geçmesine sevindik.',
      concreteLanguageTag: 'tr-Latn',
    })
    expect(harness.mocks.resolveReplyLanguage).toHaveBeenCalledWith({
      text,
      evaluatedLanguage: { tag: 'und', group: 'und' },
    })
    expectNoAiExecution(
      harness.mocks.readHeads,
      harness.mocks.claim,
      harness.mocks.claimExecution,
      harness.mocks.acquire,
      harness.mocks.generateReply,
    )
  })
})

// ── Characterization: the branches the use case settles before provider work ──

type MerchantAuthorization = NonNullable<
  Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
>
type Harness = ReturnType<typeof createHarness>

/** Answer the first authorization read with a changed copy of the harness default. */
function authorizeOnceAs(
  harness: Harness,
  change: (authorization: MerchantAuthorization) => MerchantAuthorization | null,
): void {
  const read = vi.mocked(harness.mocks.readMerchantAuthorization)
  const base = read.getMockImplementation()
  if (base === undefined) throw new Error('the harness authorization read is not mocked')
  read.mockImplementationOnce(async (input) => {
    const authorization = await base(input)
    return authorization === null ? null : change(authorization)
  })
}

/** The harness claim seen through the port, so a test can answer any claim outcome. */
const portClaim = (harness: Harness) =>
  vi.mocked(harness.mocks.claim as unknown as AiOperationStorePort['claim'])

const REFUSED_AUTHORIZATIONS: ReadonlyArray<
  readonly [
    string,
    (authorization: MerchantAuthorization) => MerchantAuthorization | null,
  ]
> = [
  ['no merchant authorization', () => null],
  ['an authorization that is not enabled', (a) => ({ ...a, state: 'disabled' })],
  ['an authorization without a lineage', (a) => ({ ...a, authorizationLineageId: null })],
  [
    'an authorization for another source epoch',
    (a) => ({ ...a, authorizedSourceEpoch: 3 }),
  ],
  [
    'an authorization without reply drafting',
    (a) => ({ ...a, capabilities: ['review_analysis'] }),
  ],
  [
    'another reply-drafting runtime profile',
    (a) => ({
      ...a,
      capabilityRuntimeProfileVersions: {
        ...a.capabilityRuntimeProfileVersions,
        reply_drafting: 'reply-drafting-runtime-v0',
      },
    }),
  ],
]

describe('generate reply suggestion: refusals before provider work', () => {
  it.each(REFUSED_AUTHORIZATIONS)(
    'answers not_authorized for %s',
    async (_label, change) => {
      const harness = createHarness()
      authorizeOnceAs(harness, change)

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'not_authorized',
        retryAfterEpochMillis: null,
      })
      expectNoAiExecution(
        harness.mocks.readHeads,
        harness.mocks.claim,
        harness.mocks.acquire,
        harness.mocks.generateReply,
      )
    },
  )

  it('answers not_authorized while the Property processing profile is unavailable', async () => {
    const harness = createHarness()
    vi.mocked(harness.mocks.readProcessingProfile).mockResolvedValueOnce({
      status: 'policy_unavailable',
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'not_authorized',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(harness.mocks.readHeads, harness.mocks.claim)
  })

  it('answers policy_unavailable when the execution stop fence is not fully open', async () => {
    const harness = createHarness()
    vi.mocked(harness.mocks.readHeads).mockResolvedValueOnce([])

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'policy_unavailable',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(harness.mocks.claim, harness.mocks.acquire)
  })

  it('answers policy_unavailable when the operation claim conflicts', async () => {
    const harness = createHarness()
    portClaim(harness).mockResolvedValueOnce({ status: 'conflict' })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'policy_unavailable',
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(
      harness.mocks.acquire,
      harness.mocks.claimExecution,
      harness.mocks.generateReply,
    )
  })

  it.each([
    'succeeded',
    'succeeded_pending_delivery',
  ] as const satisfies ReadonlyArray<AiOperationState>)(
    'answers completed_without_delivery for an operation already %s',
    async (state) => {
      const harness = createHarness()
      portClaim(harness).mockImplementationOnce(async (request) => ({
        status: 'replayed',
        operation: {
          id: OPERATION_ID,
          identity: request.identity,
          binding: request.binding,
          idempotencyKey: request.idempotencyKey,
          requestFingerprint: request.requestFingerprint,
          sourceProvenance: request.sourceProvenance,
          state,
          executionAttempt: 1,
          executionPermitId: null,
          nextAttemptAtEpochMillis: null,
          failureCode: null,
          createdAtEpochMillis: NOW,
          updatedAtEpochMillis: NOW,
          expiresAtEpochMillis: NOW + 15 * 60_000,
        },
      }))

      await expect(harness.generate(INPUT)).resolves.toEqual({
        status: 'unavailable',
        code: 'completed_without_delivery',
        retryAfterEpochMillis: null,
      })
      expectNoAiExecution(
        harness.mocks.acquire,
        harness.mocks.claimExecution,
        harness.mocks.generateReply,
      )
    },
  )
})

describe('generate reply suggestion: review-language metadata', () => {
  it.each([
    [
      { status: 'language_not_supported', reason: 'unsupported_group' },
      'language_not_supported',
    ],
    [{ status: 'policy_unavailable' }, 'policy_unavailable'],
  ] as const)('refuses %o metadata without a template request', async (mapped, code) => {
    const harness = createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })
    vi.mocked(mapReviewLanguageMetadata).mockReturnValueOnce(mapped)

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code,
      retryAfterEpochMillis: null,
    })
    expectNoAiExecution(
      harness.mocks.resolveReplyLanguage,
      harness.mocks.readDefaultReplyLanguage,
    )
  })

  it('serves a requested template for unsupported metadata in the property language', async () => {
    const harness = createHarness({ propertyReplyLanguage: 'bg-Cyrl-BG' })
    vi.mocked(mapReviewLanguageMetadata).mockReturnValueOnce({
      status: 'language_not_supported',
      reason: 'unsupported_group',
    })

    await expect(harness.generate({ ...INPUT, templateOnly: true })).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'language_undetermined',
      languageSource: 'property_default',
      replyText:
        'Благодарим ви, че споделихте този положителен отзив. Радваме се, че преживяването ви е било приятно.',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
    expectNoAiExecution(
      harness.mocks.resolveReplyLanguage,
      harness.mocks.readMerchantAuthorization,
    )
  })

  it('refuses a requested template for unsupported metadata without a property language', async () => {
    const harness = createHarness()
    vi.mocked(mapReviewLanguageMetadata).mockReturnValueOnce({
      status: 'language_not_supported',
      reason: 'unsupported_group',
    })

    await expect(harness.generate({ ...INPUT, templateOnly: true })).resolves.toEqual({
      status: 'unavailable',
      code: 'target_language_unavailable',
      retryAfterEpochMillis: null,
    })
  })

  it('refuses an unavailable language verifier unless a template was requested', async () => {
    const refused = createHarness({
      propertyReplyLanguage: 'bg-Cyrl-BG',
      replyLanguage: { status: 'policy_unavailable' },
    })
    const templated = createHarness({
      propertyReplyLanguage: 'bg-Cyrl-BG',
      replyLanguage: { status: 'policy_unavailable' },
    })

    await expect(refused.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'policy_unavailable',
      retryAfterEpochMillis: null,
    })
    await expect(
      templated.generate({ ...INPUT, templateOnly: true }),
    ).resolves.toMatchObject({
      status: 'fallback',
      reason: 'language_undetermined',
      languageSource: 'property_default',
      concreteLanguageTag: 'bg-Cyrl-BG',
    })
  })
})

describe('generate reply suggestion: operation binding', () => {
  // The identity and binding feed the RFC 8785 request fingerprint that makes
  // a claim idempotent, so any change to a field, a key or a null here is a
  // different operation. Spelled out field by field, independently of the use
  // case's own builders.
  it('claims exactly this identity, binding and request fingerprint for a fixed input', async () => {
    const harness = createHarness()

    await expect(harness.generate(INPUT)).resolves.toMatchObject({ status: 'ready' })

    const identity = {
      subjectKind: 'property',
      command: 'reply',
      capability: 'reply_drafting',
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_USER_ID,
      systemPrincipal: null,
      reviewId: REVIEW_ID,
      sourceEpoch: 2,
      sourceRevision: 5,
      tone: 'professional',
      reviewedAtEpochMillis: NOW - 1_000,
      baseReplyStateRevision: 3,
    }
    const binding = {
      authorizationLineageId: LINEAGE_ID,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: SHA,
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 7,
        baseReplyStateRevision: 3,
      },
      sourceEpoch: 2,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: parseCanonicalReplyLanguageTag('en-Latn'),
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      sourceRevision: 5,
      reviewedAtEpochMillis: NOW - 1_000,
      propertyProfileVersion: 3,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
      routingPolicyVersion: 1,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
      outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'reply-suggestion-v1',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
      aiSubjectHmacKeyVersion: null,
      stopFence: {
        globalControlId: '72000000-0000-4000-8000-000000000111',
        globalGeneration: 1,
        providerControlId: '72000000-0000-4000-8000-000000000112',
        providerGeneration: 1,
        capabilityControlId: '72000000-0000-4000-8000-000000000113',
        capabilityGeneration: 1,
      },
    }
    const sourceProvenance = aiReviewSourceProvenance(
      encodeCanonicalAiReviewSource({
        text: 'A thoughtful review.',
        rating: 5,
        languageCode: 'en-US',
        reviewedAtEpochMillis: NOW - 1_000,
      }).bytes,
    )
    const request = harness.mocks.claim.mock.calls[0]?.[0]
    expect(request?.identity).toStrictEqual(identity)
    expect(request?.binding).toStrictEqual(binding)
    expect(request?.sourceProvenance).toStrictEqual(sourceProvenance)
    expect(request?.requestFingerprint).toBe(
      aiRequestFingerprint({ identity, binding, sourceProvenance }),
    )
    expect(request?.idempotencyKey).toBe('reply-suggestion-test-key')
    expect(request?.expiresAtEpochMillis).toBe(NOW + 15 * 60_000)
  })
})
