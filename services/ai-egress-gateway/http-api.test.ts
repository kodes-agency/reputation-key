import { describe, expect, it, vi } from 'vitest'
import { MERCHANT_AI_NOTICE_DIGEST } from '../../src/shared/merchant-ai-notice-contract'
import { parseAiGatewayRouteRequest } from '../../src/shared/ai-gateway-transport-contract'
import { handleAiEgressGatewayRequest } from './http-api'
import type { AiEgressGatewayService } from './service'

const SHA = 'a'.repeat(64)
const body = {
  route: 'review-analysis',
  operationId: '10000000-0000-4000-8000-000000000001',
  permitId: '10000000-0000-4000-8000-000000000002',
  attemptNumber: 1,
  organizationId: 'better-auth-org_01',
  propertyId: '10000000-0000-4000-8000-000000000004',
  internalSubjectId: 'review_subject_01',
  actorId: null,
  binding: {
    authorizationLineageId: '10000000-0000-4000-8000-000000000005',
    noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
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
      globalControlId: '10000000-0000-4000-8000-000000000006',
      globalGeneration: 1,
      providerControlId: '10000000-0000-4000-8000-000000000007',
      providerGeneration: 1,
      capabilityControlId: '10000000-0000-4000-8000-000000000008',
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
} as const

function service(execute: AiEgressGatewayService['execute']): AiEgressGatewayService {
  return { execute, readiness: async () => true }
}

describe('AI egress gateway HTTP route boundary', () => {
  it('passes one still-live source lease to the service without consuming it first', async () => {
    const execute = vi.fn<AiEgressGatewayService['execute']>(async (lease) => {
      const route = lease.read((value) => parseAiGatewayRouteRequest(value).route)
      expect(route).toBe('review-analysis')
      lease.dispose()
      return {
        route: 'review-analysis',
        status: 'error',
        code: 'provider_unavailable',
        retryAfterEpochMillis: null,
      }
    })
    const response = await handleAiEgressGatewayRequest({
      request: new Request('https://gateway.internal/v1/review-analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      peerIdentity: 'spiffe://repkey.internal/repkey-worker',
      service: service(execute),
    })
    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a cross-route body before the service can inspect source', async () => {
    const execute = vi.fn<AiEgressGatewayService['execute']>()
    const response = await handleAiEgressGatewayRequest({
      request: new Request('https://gateway.internal/v1/reply-suggestion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      peerIdentity: 'spiffe://repkey.internal/repkey-web',
      service: service(execute),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      route: 'reply-suggestion',
      status: 'error',
      code: 'invalid_request',
    })
    expect(execute).not.toHaveBeenCalled()
  })
})
