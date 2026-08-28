import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import { parseCanonicalReplyLanguageTag } from '#/shared/ai-review-language-catalogue'
import type { AiOperationId } from '../../domain/types'
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
    gatewayErrorCode?:
      | 'provider_unavailable'
      | 'provider_rate_limited'
      | 'provider_refused'
      | 'output_invalid'
      | 'output_truncated'
  }> = {},
) {
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
      read: vi.fn(),
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
    quota: {
      acquire: vi.fn(async () => ({ ok: true as const, quotaId: 'quota-1' })),
      release,
    },
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
          rating: 5 as const,
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
      claim,
      generateReply,
      settleEphemeralReply,
      markDelivered,
      release,
      readReplyStateRevision,
      readDefaultReplyLanguage:
        dependencies.propertyReplyLanguages.readDefaultReplyLanguage,
      resolveReplyLanguage: dependencies.resolveReplyLanguage,
      readCurrentAiReplyBrandProfile,
    },
  }
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

  it('reports a textless review as no_review_text, not as a changed source', async () => {
    const harness = createHarness({ reviewText: null })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'no_review_text',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.claim).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
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

  it('separates undetectable language from an unsupported one', async () => {
    const tooShort = createHarness({
      replyLanguage: {
        status: 'language_not_supported',
        reason: 'insufficient_language_evidence',
      },
    })
    await expect(tooShort.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'language_undetermined',
      retryAfterEpochMillis: null,
    })

    const mismatched = createHarness({
      replyLanguage: {
        status: 'language_not_supported',
        reason: 'metadata_language_mismatch',
      },
    })
    await expect(mismatched.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'language_not_supported',
      retryAfterEpochMillis: null,
    })

    expect(tooShort.mocks.generateReply).not.toHaveBeenCalled()
    expect(mismatched.mocks.generateReply).not.toHaveBeenCalled()
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
      expectedAttempt: 1,
      deliveredAtEpochMillis: NOW,
    })
    expect(harness.mocks.release).toHaveBeenCalledWith({ quotaId: 'quota-1' })
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
  ] as const)('offers a labelled local fallback for %s', async (gatewayErrorCode) => {
    const harness = createHarness({ gatewayErrorCode })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'fallback',
      kind: 'local_safe_template',
      reason: 'provider_or_output_unavailable',
      replyText:
        'Thank you for sharing this positive review. We are pleased that your experience was enjoyable.',
      concreteLanguageTag: 'en-Latn',
    })
    expect(harness.mocks.settleEphemeralReply).not.toHaveBeenCalled()
    expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
    expect(harness.mocks.release).toHaveBeenCalledWith({ quotaId: 'quota-1' })
  })

  it('withholds the local fallback when the Review changes during provider work', async () => {
    const harness = createHarness({
      gatewayErrorCode: 'output_invalid',
      assertCurrentStatus: 'stale',
    })

    await expect(harness.generate(INPUT)).resolves.toEqual({
      status: 'unavailable',
      code: 'source_changed',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.settleEphemeralReply).not.toHaveBeenCalled()
    expect(harness.mocks.markDelivered).not.toHaveBeenCalled()
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

  it('keeps an otherwise resolved language dark until its personalized profile is approved', async () => {
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
      status: 'unavailable',
      code: 'language_not_supported',
      retryAfterEpochMillis: null,
    })
    expect(harness.mocks.resolveReplyLanguage).toHaveBeenCalledWith({
      text,
      evaluatedLanguage: { tag: 'und', group: 'und' },
    })
    expect(harness.mocks.claim).not.toHaveBeenCalled()
    expect(harness.mocks.generateReply).not.toHaveBeenCalled()
  })
})
