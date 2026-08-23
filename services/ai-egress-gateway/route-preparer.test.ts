import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_OPERATION_PROFILES,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
} from '../../src/shared/ai-operation-profiles'
import { AI_REDACTION_PROFILE_VERSION } from '../../src/shared/ai-deterministic-redactor'
import { parseAiGatewayRouteRequest } from '../../src/shared/ai-gateway-transport-contract'
import { LANGUAGE_CATALOGUE_DIGEST } from '../../src/shared/ai-review-language-catalogue'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '../../src/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '../../src/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '../../src/shared/ai-zh-orthography-verifier'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '../../src/shared/ai-reply-template-catalogue'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '../../src/shared/ai-reply-output-leakage'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '../../src/shared/merchant-ai-notice-contract'
import { createVersionedHmacKeyring } from '../../src/shared/security/versioned-hmac-keyring'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '../../src/shared/generated/ai-review-language-canonical-regions-v1'
import { createAiGatewayRoutePreparer } from './route-preparer'
import { createSensitiveSourceLease } from './source-lease'

const UUID = {
  operation: '10000000-0000-4000-8000-000000000001',
  permit: '10000000-0000-4000-8000-000000000002',
  property: '10000000-0000-4000-8000-000000000003',
  lineage: '10000000-0000-4000-8000-000000000004',
  global: '10000000-0000-4000-8000-000000000005',
  provider: '10000000-0000-4000-8000-000000000006',
  capability: '10000000-0000-4000-8000-000000000007',
} as const

function analysisRequest() {
  return parseAiGatewayRouteRequest({
    route: 'review-analysis',
    operationId: UUID.operation,
    permitId: UUID.permit,
    attemptNumber: 1,
    organizationId: 'better-auth-org_01',
    propertyId: UUID.property,
    internalSubjectId: 'review_subject_01',
    actorId: null,
    binding: {
      authorizationLineageId: UUID.lineage,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
      sourceEpoch: 1,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: null,
      languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 1,
      reviewedAtEpochMillis: 1_780_000_000_000,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'review-analysis-v1',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      aiSubjectHmacKeyVersion: 'subject-v1',
      stopFence: {
        globalControlId: UUID.global,
        globalGeneration: 1,
        providerControlId: UUID.provider,
        providerGeneration: 1,
        capabilityControlId: UUID.capability,
        capabilityGeneration: 1,
      },
    },
    deadlineEpochMillis: 1_780_000_070_000,
    redactionCountry: 'US',
    observedContentExpiresAtEpochMillis: 1_780_000_600_000,
    source: {
      kind: 'review',
      text: 'RAW_REVIEW_LIFETIME_SENTINEL was handled professionally.',
      rating: 5,
      languageCode: 'en-Latn',
      reviewedAtEpochMillis: 1_780_000_000_000,
    },
  })
}

function replyRequest() {
  const analysis = analysisRequest()
  return parseAiGatewayRouteRequest({
    ...analysis,
    route: 'reply-suggestion',
    actorId: 'better-auth-user_01',
    tone: 'professional',
    binding: {
      ...analysis.binding,
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: 0,
      },
      evaluatedLanguage: 'tr-Latn',
      concreteReplyLanguage: {
        tag: 'bg-Cyrl-BG',
        templateGroup: 'bg-Cyrl',
      },
      replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
      languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
      zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
      outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
      outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
      replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
      replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
      operationProfileVersion: 'reply-suggestion-v1',
      capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
      aiSubjectHmacKeyVersion: null,
    },
    source: {
      ...analysis.source,
      text: 'Konaklamamız boyunca personel çok ilgili ve yardımseverdi.',
      languageCode: 'tr-TR',
    },
  })
}

function preparer(
  detect: (text: string) => Readonly<{
    language: string
    probability: number
    reliable: boolean
  }> = () => ({ language: 'en', probability: 1, reliable: true }),
) {
  const provenance = generateKeyPairSync('ed25519')
  return createAiGatewayRoutePreparer({
    requestBindingKeys: createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`),
    safetyIdentifierKey: Buffer.alloc(32, 7),
    replyLanguageDetector: {
      detect,
    },
    provenanceKid: 'provenance-v1',
    provenancePrivateKey: provenance.privateKey,
  })
}

const acceptedAnalysis = Object.freeze({
  sentiment: 'positive',
  sentimentValence: 80,
  primaryCategory: 'service',
  urgencySignals: Object.freeze([]),
})
const fakeReceipt = () => ({ marker: 'settled-receipt' }) as never
const fakeGrant = () => ({}) as never

beforeEach(() => {
  vi.spyOn(process.versions, 'node', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  )
  vi.spyOn(process.versions, 'icu', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  )
  vi.spyOn(process.versions, 'unicode', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gateway route-preparer source lifetime', () => {
  it('keeps response closures source-free after the lease scrubs the original source root', () => {
    const request = analysisRequest()
    const sourceReference = new WeakRef(request.source)
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    expect(lease.inspect()).toMatchObject({
      disposed: true,
      hasSource: false,
      allOwnedChunksZeroed: true,
    })
    expect(sourceReference.deref()).toEqual({
      kind: null,
      text: null,
      rating: null,
      languageCode: null,
      reviewedAtEpochMillis: null,
    })
    const accepted = prepared.acceptProviderResult(acceptedAnalysis)
    expect(accepted).not.toBeNull()
    expect(accepted?.buildResponse(fakeReceipt(), fakeGrant())).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: acceptedAnalysis,
    })
  })

  it('isolates result acceptance and response construction from later request mutation', () => {
    const request = analysisRequest()
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    Object.assign(request as unknown as Record<string, unknown>, {
      route: 'reply-suggestion',
      operationId: 'mutated-operation',
      actorId: 'mutated-actor',
    })
    Object.assign(request.binding as unknown as Record<string, unknown>, {
      operationProfileVersion: 'mutated-profile',
      sourceEpoch: 999,
    })
    const accepted = prepared.acceptProviderResult(acceptedAnalysis)
    expect(accepted).not.toBeNull()
    const response = accepted?.buildResponse(fakeReceipt(), fakeGrant())
    expect(response).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: acceptedAnalysis,
    })
    expect(JSON.stringify(response)).not.toContain('mutated')
  })

  it('derives preparation limits from the pinned operation catalogue', () => {
    const request = analysisRequest()
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    const profile = AI_OPERATION_PROFILES.find(
      (entry) => entry.sourceRoute === 'review-analysis',
    )
    expect(profile).toBeDefined()
    expect(prepared.invocation.descriptor.limits).toMatchObject({
      sourceBytes: profile?.sourceByteLimit,
      providerPayloadBytes: profile?.providerPayloadByteLimit,
      preparedRequestBytes: profile?.preparedRequestByteLimit,
      responseBytes: profile?.responseByteLimit,
      outputTokens: profile?.maxOutputTokens,
    })
  })

  it('verifies a regional Turkish source group independently and admits the bound Bulgarian target', () => {
    const request = replyRequest()
    if (request.route !== 'reply-suggestion') {
      throw new Error('expected reply suggestion request')
    }
    const prepared = preparer((text) => ({
      language: /[\u0400-\u04ff]/u.test(text) ? 'bg' : 'tr',
      probability: 1,
      reliable: true,
    })).prepare(request)

    expect(JSON.parse(prepared.invocation.sdkRequest.input[1].content)).toMatchObject({
      reviewText: request.source.text,
      languageCode: 'bg-Cyrl-BG',
      tone: 'professional',
    })
    expect(prepared.invocation.descriptor.binding).toMatchObject({
      evaluatedLanguage: 'tr-Latn',
      concreteReplyLanguage: {
        tag: 'bg-Cyrl-BG',
        templateGroup: 'bg-Cyrl',
      },
    })
    const accepted = prepared.acceptProviderResult({
      templateId: 'appreciation_positive',
      languageCode: 'bg-Cyrl-BG',
    })
    expect(accepted).not.toBeNull()
    expect(
      accepted?.buildResponse(fakeReceipt(), {
        requestBindingHmac: 'A'.repeat(43),
        replyTokenExpiresAtEpochMillis: Date.now() + 60_000,
        replyDraftExpiresAtEpochMillis: Date.now() + 120_000,
      } as never),
    ).toMatchObject({
      route: 'reply-suggestion',
      status: 'success',
      result: {
        concreteLanguageTag: 'bg-Cyrl-BG',
        templateGroup: 'bg-Cyrl',
      },
    })
  })
})
