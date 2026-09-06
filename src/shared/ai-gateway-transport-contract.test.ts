import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  parseAiGatewayRouteRequest,
  parseAiGatewayRouteResponse,
} from './ai-gateway-transport-contract'
import { aiInternalSafeIdSchema } from './ai-internal-transport-contract'
import {
  analysisRequest,
  receipt,
  replyRequest,
  trendRequest,
} from './ai-gateway-transport-contract.test-fixtures'

describe('AI gateway caller-wire contract', () => {
  it('accepts exact operation permit and attempt metadata with the complete route DTO', () => {
    expect(parseAiGatewayRouteRequest(analysisRequest())).toEqual(analysisRequest())
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
