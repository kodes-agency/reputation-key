import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  AI_GATEWAY_PATHS_V1,
  assertAiGatewayPeerRoute,
  parseAiGatewayRouteRequest,
  parseAiGatewayRouteResponse,
  type PropertyTrendGatewayRequestV1,
  type ReplySuggestionGatewayRequestV1,
  type ReviewAnalysisGatewayRequestV1,
} from './ai-gateway-transport-contract'
import { aiInternalSafeIdSchema } from './ai-internal-transport-contract'
import { computeDeterministicTrendCandidates } from './ai-property-trend-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from './merchant-ai-notice-contract'

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  permit: '10000000-0000-4000-8000-000000000002',
  organization: '10000000-0000-4000-8000-000000000003',
  property: '10000000-0000-4000-8000-000000000004',
  lineage: '10000000-0000-4000-8000-000000000005',
  globalControl: '10000000-0000-4000-8000-000000000006',
  providerControl: '10000000-0000-4000-8000-000000000007',
  capabilityControl: '10000000-0000-4000-8000-000000000008',
} as const
const SHA = 'a'.repeat(64)

function analysisRequest(): ReviewAnalysisGatewayRequestV1 {
  return {
    route: 'review-analysis',
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 1,
    organizationId: 'better-auth-org_01',
    propertyId: UUIDS.property,
    internalSubjectId: 'review_subject_01',
    actorId: null,
    binding: {
      authorizationLineageId: UUIDS.lineage,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
      sourceEpoch: 1,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: null,
      languageCatalogueDigest: SHA,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 1,
      reviewedAtEpochMillis: 1_780_000_000_000,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      sourcePolicyId: 'ai-source-v1',
      sourceCanonicalizerDigest: SHA,
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'review-analysis-v1',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      aiSubjectHmacKeyVersion: 'v1',
      stopFence: {
        globalControlId: UUIDS.globalControl,
        globalGeneration: 1,
        providerControlId: UUIDS.providerControl,
        providerGeneration: 1,
        capabilityControlId: UUIDS.capabilityControl,
        capabilityGeneration: 1,
      },
    },
    deadlineEpochMillis: 1_780_000_070_000,
    redactionCountry: 'US',
    observedContentExpiresAtEpochMillis: 1_780_000_600_000,
    source: {
      kind: 'review',
      text: 'A bounded synthetic review.',
      rating: 5,
      languageCode: 'en-Latn',
      reviewedAtEpochMillis: 1_780_000_000_000,
    },
  }
}

function replyRequest(): ReplySuggestionGatewayRequestV1 {
  const analysis = analysisRequest()
  return {
    ...analysis,
    route: 'reply-suggestion',
    actorId: 'better-auth-user_01',
    replyProfileVersion: 'reply-draft-v2',
    brandProfile: { displayName: 'Example Hotel' },
    tone: 'professional',
    binding: {
      ...analysis.binding,
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: 0,
      },
      concreteReplyLanguage: { tag: 'en-Latn', templateGroup: 'en-Latn' },
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest:
        '030c644bf71ad1d7570dc9ab6131f5209ac02fa65e930e2910778e024fc643bf',
      replyLanguageVerifierDigest: SHA,
      languageScriptConsistencyDigest: SHA,
      zhOrthographyVerifierDigest: SHA,
      outputLeakageProfileVersion: 'gbp-reply-output-leakage-v1',
      outputLeakageProfileDigest: SHA,
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
      replyTemplateCatalogueDigest: SHA,
      operationProfileVersion: 'reply-suggestion-v1',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
      aiSubjectHmacKeyVersion: null,
    },
  }
}

const baselineWindow = {
  reviewCount: 20,
  sentimentCounts: { positive: 4, neutral: 8, negative: 6, mixed: 2 },
  attentionCounts: { urgent: 2, high: 4, medium: 6, low: 8 },
  categoryCounts: {
    service: 2,
    staff: 4,
    quality: 2,
    value: 2,
    cleanliness: 2,
    waitTime: 0,
    atmosphere: 0,
    location: 0,
    accessibility: 0,
    other: 8,
  },
} as const
const currentWindow = {
  reviewCount: 20,
  sentimentCounts: { positive: 14, neutral: 2, negative: 2, mixed: 2 },
  attentionCounts: { urgent: 0, high: 2, medium: 4, low: 14 },
  categoryCounts: {
    service: 10,
    staff: 2,
    quality: 2,
    value: 2,
    cleanliness: 2,
    waitTime: 0,
    atmosphere: 0,
    location: 0,
    accessibility: 0,
    other: 2,
  },
} as const

function trendRequest(): PropertyTrendGatewayRequestV1 {
  const analysis = analysisRequest()
  const candidates = computeDeterministicTrendCandidates({
    currentWindow,
    baselineWindow,
  })
  return {
    route: 'property-trend',
    operationId: analysis.operationId,
    permitId: analysis.permitId,
    attemptNumber: analysis.attemptNumber,
    organizationId: analysis.organizationId,
    propertyId: analysis.propertyId,
    internalSubjectId: 'property_trend_subject_01',
    actorId: null,
    binding: {
      ...analysis.binding,
      capabilityFence: {
        capability: 'property_trends',
        reviewAnalysisEpoch: 1,
        propertyTrendsEpoch: 1,
      },
      evaluatedLanguage: null,
      languageCatalogueDigest: null,
      sourceRevision: null,
      reviewedAtEpochMillis: null,
      operationProfileVersion: 'property-trend-v1',
      capabilityRuntimeProfileVersion: 'property-trends-runtime-v1',
      aiSubjectHmacKeyVersion: null,
    },
    deadlineEpochMillis: 1_780_000_100_000,
    source: {
      languageCode: 'en',
      currentWindow,
      baselineWindow,
      candidates,
    },
  }
}

const receipt = {
  version: 'ai-settlement-receipt-v1',
  receiptKid: 'receipt_v1',
  grantKid: 'grant_v1',
  operationId: UUIDS.operation,
  permitId: UUIDS.permit,
  attemptNumber: 1,
  nonce: 'AQIDBA',
  requestBindingHmac: 'A'.repeat(43),
  disposition: 'success',
  reportedDisposition: 'success',
  providerRetryable: false,
  usageKnown: true,
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 20,
  reasoningTokens: 5,
  costMicros: 42,
  settledAtEpochMillis: 1_780_000_001_000,
  settlementState: 'settled',
  receiptSignature: 'A'.repeat(86),
} as const

describe('AI gateway caller-wire contract', () => {
  it('accepts exact operation permit and attempt metadata with the complete route DTO', () => {
    expect(parseAiGatewayRouteRequest(analysisRequest())).toEqual(analysisRequest())
    expect(AI_GATEWAY_PATHS_V1).toEqual({
      'review-analysis': '/v1/review-analysis',
      'reply-suggestion': '/v1/reply-suggestion',
      'property-trend': '/v1/property-trend',
    })
  })

  // `properties.source_epoch` is 0-based (drizzle/0060). Every fixture in this
  // file used `sourceEpoch: 1`, so `sourceEpoch: positive` on the binding survived
  // here and rejected the reply request for a freshly imported property with
  // `Too small: expected number to be >0` — a 500, after the operation identity
  // and consent had already been fixed.
  it('accepts the domain default source epoch of 0 on the binding', () => {
    for (const request of [analysisRequest(), replyRequest()]) {
      const atZero = { ...request, binding: { ...request.binding, sourceEpoch: 0 } }
      expect(parseAiGatewayRouteRequest(atZero)).toEqual(atZero)
    }
  })

  it('still rejects a negative source epoch and keeps the 1-based versions strict', () => {
    const request = replyRequest()
    expect(() =>
      parseAiGatewayRouteRequest({
        ...request,
        binding: { ...request.binding, sourceEpoch: -1 },
      }),
    ).toThrow(ZodError)
    for (const field of ['propertyProfileVersion', 'routingPolicyVersion']) {
      expect(() =>
        parseAiGatewayRouteRequest({
          ...request,
          binding: { ...request.binding, [field]: 0 },
        }),
      ).toThrow(ZodError)
    }
  })

  it('shares the admission-safe identifier grammar for organization, actor, and subject IDs', () => {
    expect(aiInternalSafeIdSchema.parse(analysisRequest().organizationId)).toBe(
      'better-auth-org_01',
    )
    expect(parseAiGatewayRouteRequest(analysisRequest()).organizationId).toBe(
      'better-auth-org_01',
    )
    expect(parseAiGatewayRouteRequest(replyRequest()).actorId).toBe('better-auth-user_01')
    for (const malformed of ['organization id', 'org-é', 'org\u0000id']) {
      expect(() =>
        parseAiGatewayRouteRequest({ ...analysisRequest(), organizationId: malformed }),
      ).toThrow(ZodError)
    }
    expect(() =>
      parseAiGatewayRouteRequest({ ...replyRequest(), actorId: 'user-é' }),
    ).toThrow(ZodError)
    expect(() =>
      parseAiGatewayRouteRequest({
        ...analysisRequest(),
        internalSubjectId: 'subject with spaces',
      }),
    ).toThrow(ZodError)
  })

  it('rejects unpaired surrogates in review source text and language metadata', () => {
    for (const malformed of ['\uD800', 'before\uD800after', '\uDC00']) {
      expect(() =>
        parseAiGatewayRouteRequest({
          ...analysisRequest(),
          source: { ...analysisRequest().source, text: malformed },
        }),
      ).toThrow(ZodError)
      expect(() =>
        parseAiGatewayRouteRequest({
          ...analysisRequest(),
          source: { ...analysisRequest().source, languageCode: malformed },
        }),
      ).toThrow(ZodError)
    }
    const parsed = parseAiGatewayRouteRequest({
      ...analysisRequest(),
      source: { ...analysisRequest().source, text: 'valid 😀 source' },
    })
    if (parsed.route === 'property-trend')
      throw new Error('expected source-bearing request')
    expect(parsed.source.text).toBe('valid 😀 source')
  })

  it('rejects a reply binding whose concrete tag and template group are cross-wired', () => {
    const request = replyRequest()
    expect(() =>
      parseAiGatewayRouteRequest({
        ...request,
        binding: {
          ...request.binding,
          concreteReplyLanguage: {
            tag: 'en-Latn',
            templateGroup: 'es-Latn',
          },
        },
      }),
    ).toThrow(ZodError)
  })

  it('carries only the distinct personalized profile on the reply route', () => {
    expect(parseAiGatewayRouteRequest(replyRequest())).toMatchObject({
      route: 'reply-suggestion',
      replyProfileVersion: 'reply-draft-v2',
      brandProfile: { displayName: 'Example Hotel' },
    })
    expect(() =>
      parseAiGatewayRouteRequest({
        ...replyRequest(),
        replyProfileVersion: 'reply-suggestion-v1',
      }),
    ).toThrow(ZodError)
    expect(() =>
      parseAiGatewayRouteRequest({
        ...replyRequest(),
        brandProfile: {
          displayName: 'Example Hotel',
          logoUrl: 'https://cdn.example/logo.png',
        },
      }),
    ).toThrow(ZodError)

    const response = {
      route: 'reply-suggestion',
      status: 'success',
      result: {
        profileVersion: 'reply-draft-v2',
        replyText: 'Thank you for sharing that the room was quiet during your stay.',
        provenanceToken: 'signed-personalized-provenance',
        expiresAtEpochMillis: 1_780_000_010_000,
        baseReplyStateRevision: 0,
        concreteLanguageTag: 'en-Latn',
        templateGroup: 'en-Latn',
      },
      settlementReceipt: receipt,
    }
    expect(parseAiGatewayRouteResponse(response)).toEqual(response)
    expect(() =>
      parseAiGatewayRouteResponse({
        ...response,
        result: { ...response.result, templateId: 'appreciation_positive' },
      }),
    ).toThrow(ZodError)
  })

  it('requires the exact deterministic top-12 trend candidates in canonical order', () => {
    const request = trendRequest()
    expect(parseAiGatewayRouteRequest(request)).toEqual(request)
    expect(request.source.candidates.length).toBeGreaterThan(3)

    const reversed = [...request.source.candidates].reverse()
    const wrongCount = request.source.candidates.slice(1)
    const [first, ...rest] = request.source.candidates
    const wrongDirection = [
      {
        ...first!,
        id: first!.id.endsWith('.up')
          ? first!.id.replace(/\.up$/, '.down')
          : first!.id.replace(/\.down$/, '.up'),
      },
      ...rest,
    ]
    const belowThreshold = [
      {
        ...first!,
        currentNumerator: first!.baselineNumerator,
      },
      ...rest,
    ]

    for (const candidates of [reversed, wrongCount, wrongDirection, belowThreshold]) {
      expect(() =>
        parseAiGatewayRouteRequest({
          ...request,
          source: { ...request.source, candidates },
        }),
      ).toThrow(ZodError)
    }
  })

  it.each([
    'descriptor',
    'sourceDigest',
    'preparedDigest',
    'requestBindingHmac',
    'requestBindingKeyId',
    'preparedPayload',
    'redactedPayload',
  ])('rejects caller-supplied gateway-private field %s', (field) => {
    expect(() =>
      parseAiGatewayRouteRequest({ ...analysisRequest(), [field]: 'forbidden' }),
    ).toThrow(ZodError)
  })

  it('rejects unknown nested fields and cross-wired route bindings', () => {
    const input = analysisRequest()
    expect(() =>
      parseAiGatewayRouteRequest({
        ...input,
        source: { ...input.source, descriptor: {} },
      }),
    ).toThrow(ZodError)
    expect(() =>
      parseAiGatewayRouteRequest({
        ...input,
        binding: {
          ...input.binding,
          capabilityFence: {
            capability: 'reply_drafting',
            replyDraftingEpoch: 1,
            baseReplyStateRevision: 0,
          },
        },
      }),
    ).toThrow(ZodError)
  })

  it('accepts only strict route-matched success and error responses', () => {
    const success = {
      route: 'review-analysis',
      status: 'success',
      result: {
        sentiment: 'positive',
        sentimentValence: 80,
        primaryCategory: 'service',
        urgencySignals: [],
      },
      settlementReceipt: receipt,
    }
    expect(parseAiGatewayRouteResponse(success)).toEqual(success)
    expect(
      parseAiGatewayRouteResponse({
        route: 'review-analysis',
        status: 'error',
        code: 'provider_rate_limited',
        retryAfterEpochMillis: 1_780_000_010_000,
      }),
    ).toMatchObject({ status: 'error', code: 'provider_rate_limited' })
    for (const field of [
      'providerRequestId',
      'providerResponseId',
      'requestId',
      'safetyIdentifier',
    ]) {
      expect(() =>
        parseAiGatewayRouteResponse({ ...success, [field]: 'forbidden' }),
      ).toThrow(ZodError)
    }
    expect(() =>
      parseAiGatewayRouteResponse({
        ...success,
        result: { ...success.result, reasoning: 'forbidden' },
      }),
    ).toThrow(ZodError)
  })
})

describe('AI gateway route/certificate matrix', () => {
  it('allows only the compiled web and worker route combinations', () => {
    expect(
      assertAiGatewayPeerRoute(
        'review-analysis',
        'spiffe://repkey.internal/repkey-worker',
      ),
    ).toBe('worker')
    expect(
      assertAiGatewayPeerRoute(
        'property-trend',
        'spiffe://repkey.internal/repkey-worker',
      ),
    ).toBe('worker')
    expect(
      assertAiGatewayPeerRoute('reply-suggestion', 'spiffe://repkey.internal/repkey-web'),
    ).toBe('web')

    for (const [route, identity] of [
      ['review-analysis', 'spiffe://repkey.internal/repkey-web'],
      ['property-trend', 'spiffe://repkey.internal/repkey-web'],
      ['reply-suggestion', 'spiffe://repkey.internal/repkey-worker'],
      ['review-analysis', 'spiffe://repkey.internal/ai-egress-gateway'],
      ['review-analysis', null],
    ] as const) {
      expect(() => assertAiGatewayPeerRoute(route, identity)).toThrow(
        /identity is not authorized/,
      )
    }
  })
})
