// Shared fixtures for the AI gateway transport contract.
//
// Extracted from `ai-gateway-transport-contract.test.ts` in WP2.3 because a
// second suite needs schema-VALID requests: the in-process adapter parses with
// the same strict schema before it authorizes a caller, so a hand-rolled
// partial object cannot exercise it. Duplicating ~200 lines of fixture into that
// suite would have guaranteed the two drift apart.
//
// `.test-fixtures.ts` is the established suffix here — `provider-client-singleton`
// and the production-artifact walkers already exclude it from production trees.

import {
  type PropertyTrendGatewayRequestV1,
  type ReplySuggestionGatewayRequestV1,
  type ReviewAnalysisGatewayRequestV1,
} from './ai-gateway-transport-contract'
import { computeDeterministicTrendCandidates } from './ai-property-trend-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from './merchant-ai-notice-contract'

export const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  permit: '10000000-0000-4000-8000-000000000002',
  organization: '10000000-0000-4000-8000-000000000003',
  property: '10000000-0000-4000-8000-000000000004',
  lineage: '10000000-0000-4000-8000-000000000005',
  globalControl: '10000000-0000-4000-8000-000000000006',
  providerControl: '10000000-0000-4000-8000-000000000007',
  capabilityControl: '10000000-0000-4000-8000-000000000008',
} as const
export const SHA = 'a'.repeat(64)

export function analysisRequest(): ReviewAnalysisGatewayRequestV1 {
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

export function replyRequest(): ReplySuggestionGatewayRequestV1 {
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

export const baselineWindow = {
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
export const currentWindow = {
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

export function trendRequest(): PropertyTrendGatewayRequestV1 {
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

export const receipt = {
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
