// Historical v1 remains readable; these contract regressions deliberately pin its old execution.
vi.mock('#/shared/ai-runtime-capability-contract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#/shared/ai-runtime-capability-contract')>()
  const { historicalReplyRuntime } =
    await import('#/shared/testing/historical-reply-runtime')
  return historicalReplyRuntime(actual)
})
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
} from '#/shared/ai-operation-profiles'
import { AI_REDACTION_PROFILE_VERSION } from '#/shared/ai-deterministic-redactor'
import { parseAiGatewayRouteRequest } from '#/shared/ai-gateway-transport-contract'
import { LANGUAGE_CATALOGUE_DIGEST } from '#/shared/ai-review-language-catalogue'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
} from '#/shared/ai-reply-template-catalogue'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import { type AiReplyOutputRefusal, createAiGatewayRoutePreparer } from './route-preparer'
import { openAiRequestOf, preparableV3Request } from './review-evidence.test-fixtures'
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

// The retired v2 form of a review-analysis request, kept only as the base of the reply
// request below (review analysis is served as v3: `analysisV3Request`). Not parsed:
// the live transport refuses it as cross-wired.
function v2FormAnalysisInput() {
  return {
    route: 'review-analysis' as const,
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
      providerDeploymentProfileVersion: AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion,
      operationProfileVersion: 'review-analysis-v2',
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
  }
}

function replyRequest() {
  const analysis = v2FormAnalysisInput()
  return parseAiGatewayRouteRequest({
    ...analysis,
    route: 'reply-suggestion',
    actorId: 'better-auth-user_01',
    replyProfileVersion: 'reply-draft-v3',
    brandProfile: { displayName: 'Example Hotel' },
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
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest:
        '030c644bf71ad1d7570dc9ab6131f5209ac02fa65e930e2910778e024fc643bf',
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
  onOutputRefused?: (refusal: AiReplyOutputRefusal) => void,
) {
  const provenance = generateKeyPairSync('ed25519')
  return createAiGatewayRoutePreparer({
    ...(onOutputRefused ? { onOutputRefused } : {}),
    requestBindingKeys: createVersionedHmacKeyring(`request-v1:${'11'.repeat(32)}`),
    safetyIdentifierKey: Buffer.alloc(32, 7),
    replyLanguageDetector: {
      detect,
    },
    provenanceKid: 'provenance-v1',
    provenancePrivateKey: provenance.privateKey,
  })
}

// A v3 provider answer: one complaint, stated by the first sentence of the review.
const acceptedAnalysis = Object.freeze({
  sentiment: 'negative',
  mentions: Object.freeze([
    Object.freeze({
      topic: 'speed_waiting',
      polarity: 'negative',
      strength: 'clear',
      thing: 'check-in',
      issue: 'slow',
      sentences: Object.freeze([2]),
      names_person: null,
    }),
  ]),
  urgent: null,
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
    const request = preparableV3Request()
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
      sentences: null,
    })
    const accepted = prepared.acceptProviderResult(acceptedAnalysis)
    expect(accepted).not.toBeNull()
    expect(accepted?.buildResponse(fakeReceipt(), fakeGrant())).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: { contract: 'review-analysis-v3' },
    })
  })

  it('isolates result acceptance and response construction from later request mutation', () => {
    const request = preparableV3Request()
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
      result: { contract: 'review-analysis-v3' },
    })
    expect(JSON.stringify(response)).not.toContain('mutated')
  })

  it('derives preparation limits from the pinned operation catalogue', () => {
    const request = preparableV3Request()
    const lease = createSensitiveSourceLease<typeof request>()
    lease.attachSource(request, (root) => root.source)
    const prepared = lease.read((leased) => preparer().prepare(leased))
    const profile = AI_OPERATION_PROFILES.find(
      (entry) =>
        entry.sourceRoute === 'review-analysis' &&
        entry.profileVersion === request.binding.operationProfileVersion,
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

  // A refused draft lands on the operation as one opaque `output_invalid`,
  // after the provider has been billed and while the operator is shown a local
  // fallback. Attributing eleven real refusals on the beta property required
  // attaching a probe to the running process, so each rule now names itself.
  it('names the rule that refused a reply draft, without carrying its content', () => {
    const request = replyRequest()
    if (request.route !== 'reply-suggestion') {
      throw new Error('expected reply suggestion request')
    }
    const refusals: AiReplyOutputRefusal[] = []
    const prepared = preparer(
      (text) => ({
        language: /[\u0400-\u04ff]/u.test(text) ? 'bg' : 'tr',
        probability: 1,
        reliable: true,
      }),
      (refusal) => refusals.push(refusal),
    ).prepare(request)

    // The provider writes only the body, so the business name is not required.
    expect(
      prepared.acceptProviderResult({
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Благодарим ви за отзива. Радваме се, че внимателният и отзивчив персонал е допринесъл за приятния ви престой.',
        grounding: [
          {
            sourceExcerpt: 'personel çok ilgili ve yardımseverdi',
            replyExcerpt: 'внимателният и отзивчив персонал',
          },
        ],
      }),
    ).not.toBeNull()

    // Quotes words the review never contained, so the grounding anchor refuses.
    expect(
      prepared.acceptProviderResult({
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Example Hotel ви благодари за отзива. Радваме се, че закуската беше на ниво и че престоят ви бе приятен.',
        grounding: [
          {
            sourceExcerpt: 'rooftop pool was heated',
            replyExcerpt: 'закуската беше на ниво',
          },
        ],
      }),
    ).toBeNull()

    expect(refusals).toEqual([{ route: 'reply-suggestion', reason: 'grounding' }])
    // Identifiers only: no review text, no reply text, no excerpt.
    expect(JSON.stringify(refusals)).not.toMatch(/благодар|persone|rooftop/i)
  })

  it('reports nothing when the draft is accepted', () => {
    const request = replyRequest()
    if (request.route !== 'reply-suggestion') {
      throw new Error('expected reply suggestion request')
    }
    const refusals: AiReplyOutputRefusal[] = []
    const prepared = preparer(
      (text) => ({
        language: /[\u0400-\u04ff]/u.test(text) ? 'bg' : 'tr',
        probability: 1,
        reliable: true,
      }),
      (refusal) => refusals.push(refusal),
    ).prepare(request)

    expect(
      prepared.acceptProviderResult({
        languageCode: 'bg-Cyrl-BG',
        replyText:
          'Example Hotel ви благодари за отзива. Радваме се, че внимателният и отзивчив персонал е допринесъл за приятния ви престой.',
        grounding: [
          {
            sourceExcerpt: 'personel çok ilgili ve yardımseverdi',
            replyExcerpt: 'внимателният и отзивчив персонал',
          },
        ],
      }),
    ).not.toBeNull()
    expect(refusals).toEqual([])
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

    expect(JSON.parse(openAiRequestOf(prepared).input[1].content)).toMatchObject({
      reviewText: request.source.text,
      languageCode: 'bg-Cyrl-BG',
      tone: 'professional',
    })
    expect(
      Object.keys(JSON.parse(openAiRequestOf(prepared).input[1].content)).sort(),
    ).toEqual(['languageCode', 'rating', 'replyProfileVersion', 'reviewText', 'tone'])
    expect(prepared.invocation.descriptor.binding).toMatchObject({
      evaluatedLanguage: 'tr-Latn',
      concreteReplyLanguage: {
        tag: 'bg-Cyrl-BG',
        templateGroup: 'bg-Cyrl',
      },
    })
    const accepted = prepared.acceptProviderResult({
      languageCode: 'bg-Cyrl-BG',
      replyText:
        'Example Hotel ви благодари за отзива. Радваме се, че внимателният и отзивчив персонал е допринесъл за приятния ви престой.',
      grounding: [
        {
          sourceExcerpt: 'personel çok ilgili ve yardımseverdi',
          replyExcerpt: 'внимателният и отзивчив персонал',
        },
      ],
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
        profileVersion: 'reply-draft-v3',
        concreteLanguageTag: 'bg-Cyrl-BG',
        templateGroup: 'bg-Cyrl',
      },
    })
  })

  it('keeps local voice and reviewer framing out of the provider payload', () => {
    const request = parseAiGatewayRouteRequest({
      ...replyRequest(),
      replyLocalFrame: {
        prefix: 'Hi Maria,',
        suffix: 'Please contact private@example.test.\n\nWarmly,\nAna, Manager',
        voiceDigest: 'a'.repeat(64),
        reviewerDisplayName: 'Maria Private',
        contact: 'private@example.test',
        signerName: 'Ana Private',
        signerTitle: 'Manager',
        businessName: 'Private Hotel',
      },
    })
    const prepared = preparer((text) => ({
      language: /[\u0400-\u04ff]/u.test(text) ? 'bg' : 'tr',
      probability: 1,
      reliable: true,
    })).prepare(request)
    const payload = openAiRequestOf(prepared).input[1].content
    expect(payload).not.toContain('Maria Private')
    expect(payload).not.toContain('private@example.test')
    expect(payload).not.toContain('Ana Private')
    expect(payload).not.toContain('Private Hotel')
  })
})
