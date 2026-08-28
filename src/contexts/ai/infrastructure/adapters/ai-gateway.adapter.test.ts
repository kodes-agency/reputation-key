import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { signAiSettlementReceipt } from '#/shared/ai-internal-transport-contract'
import type { InternalMtlsRawResponse } from '../../../../../services/internal-mtls'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '../../../../../src/shared/merchant-ai-notice-contract'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  CLOSED_TREND_SIGNAL_IDS,
  computeDeterministicTrendCandidates,
} from '#/shared/ai-property-trend-contract'
import type { AiOperationId, InternalAiSubjectId } from '../../domain/types'
import type {
  PropertyTrendSourceInput,
  ReplySuggestionSourceInput,
  ReviewAnalysisSourceInput,
} from '../../application/ports/ai-inference.port'
import { createAiGatewayAdapter, type AiGatewayByteTransport } from './ai-gateway.adapter'

const NOW = 1_780_000_000_000
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
const settlementSigningKeys = generateKeyPairSync('ed25519')
const settlementPublicKeys = new Map([
  ['receipt_v1', settlementSigningKeys.publicKey],
  ['grant_v1', settlementSigningKeys.publicKey],
])
function aiOperationId(value: string): AiOperationId {
  return value as AiOperationId
}

function internalAiSubjectId(value: string): InternalAiSubjectId {
  return value as InternalAiSubjectId
}

function analysisInput(deadlineEpochMillis = NOW + 70_000): ReviewAnalysisSourceInput {
  return {
    route: 'review-analysis',
    operationId: aiOperationId(UUIDS.operation),
    permitId: UUIDS.permit,
    attemptNumber: 2,
    organizationId: organizationId('better-auth-org_01'),
    propertyId: propertyId(UUIDS.property),
    internalSubjectId: internalAiSubjectId('review_subject_01'),
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
      reviewedAtEpochMillis: NOW,
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
    deadlineEpochMillis,
    redactionCountry: 'US',
    observedContentExpiresAtEpochMillis: NOW + 600_000,
    source: {
      kind: 'review',
      text: 'RAW_REVIEW_SENTINEL',
      rating: 5,
      languageCode: 'en-Latn',
      reviewedAtEpochMillis: NOW,
    },
  }
}

function replyInput(): ReplySuggestionSourceInput {
  const analysis = analysisInput()
  return {
    ...analysis,
    route: 'reply-suggestion',
    actorId: userId('better-auth-user_01'),
    replyProfileVersion: 'reply-draft-v2',
    brandProfile: { displayName: 'Example Hotel' },
    tone: 'professional',
    binding: {
      ...analysis.binding,
      capabilityFence: {
        capability: 'reply_drafting',
        replyDraftingEpoch: 1,
        baseReplyStateRevision: 7,
      },
      concreteReplyLanguage: { tag: 'en-Latn', templateGroup: 'en-Latn' },
      replyLanguageVerifierDigest: SHA,
      languageScriptConsistencyDigest: SHA,
      zhOrthographyVerifierDigest: SHA,
      replyBrandProfileVersion: 1,
      replyBrandDisplayNameDigest: SHA,
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

function trendInput(): PropertyTrendSourceInput {
  const analysis = analysisInput(NOW + 100_000)
  return {
    route: 'property-trend',
    operationId: analysis.operationId,
    permitId: analysis.permitId,
    attemptNumber: analysis.attemptNumber,
    organizationId: analysis.organizationId,
    propertyId: analysis.propertyId,
    internalSubjectId: internalAiSubjectId('property_trend_subject_01'),
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
    deadlineEpochMillis: NOW + 100_000,
    source: {
      languageCode: 'en',
      currentWindow,
      baselineWindow,
      candidates: computeDeterministicTrendCandidates({
        currentWindow,
        baselineWindow,
      }),
    },
  }
}

const receipt = signAiSettlementReceipt(
  {
    version: 'ai-settlement-receipt-v1',
    receiptKid: 'receipt_v1',
    grantKid: 'grant_v1',
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 2,
    nonce: 'AQIDBA',
    requestBindingHmac: 'A'.repeat(43),
    disposition: 'success',
    reportedDisposition: 'success',
    providerRetryable: false,
    usageKnown: true,
    inputTokens: 100,
    cachedInputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 5,
    costMicros: 42,
    settledAtEpochMillis: NOW + 1_000,
    settlementState: 'settled',
  },
  settlementSigningKeys.privateKey,
)

function response(value: unknown, status = 200): InternalMtlsRawResponse {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
    body: new TextEncoder().encode(JSON.stringify(value)),
  }
}

function successResponse(settlementReceipt = receipt) {
  return response({
    route: 'review-analysis',
    status: 'success',
    result: {
      sentiment: 'positive',
      sentimentValence: 80,
      primaryCategory: 'service',
      urgencySignals: [],
    },
    settlementReceipt,
  })
}

function replySuccessResponse(
  result: Readonly<{
    concreteLanguageTag: string
    templateGroup: string
    baseReplyStateRevision: number
  }>,
) {
  return response({
    route: 'reply-suggestion',
    status: 'success',
    result: {
      profileVersion: 'reply-draft-v2',
      replyText: 'Thank you for sharing your thoughtful review with our team.',
      provenanceToken: 'signed-provenance-token',
      expiresAtEpochMillis: NOW + 10_000,
      ...result,
    },
    settlementReceipt: receipt,
  })
}

function trendSuccessResponse(selectedSignalIds: readonly string[]) {
  return response({
    route: 'property-trend',
    status: 'success',
    result: { selectedSignalIds },
    settlementReceipt: receipt,
  })
}

function transportReturning(value: InternalMtlsRawResponse | Error) {
  const retainedBodies: Uint8Array[] = []
  const capturedPayloads: unknown[] = []
  const postBytesRaw = vi.fn(
    async (
      _path: string,
      body: Uint8Array,
      _options: Readonly<{ signal?: AbortSignal; deadlineEpochMillis?: number }>,
    ) => {
      retainedBodies.push(body)
      capturedPayloads.push(JSON.parse(new TextDecoder().decode(body)))
      if (value instanceof Error) throw value
      return value
    },
  )
  return {
    transport: { postBytesRaw } satisfies AiGatewayByteTransport,
    postBytesRaw,
    retainedBodies,
    capturedPayloads,
  }
}

describe('AI gateway adapter', () => {
  it('uses only the runtime-catalogued path and forwards exact claim metadata/deadline', async () => {
    const fake = transportReturning(successResponse())
    const adapter = createAiGatewayAdapter({
      transport: fake.transport,
      caller: 'worker',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    const result = await adapter.analyzeReview(
      analysisInput(),
      new AbortController().signal,
    )

    expect(result.status).toBe('success')
    expect(fake.postBytesRaw).toHaveBeenCalledTimes(1)
    const [path, bytes, options] = fake.postBytesRaw.mock.calls[0]!
    expect(path).toBe('/v1/review-analysis')
    const sent = fake.capturedPayloads[0]
    expect(sent).toMatchObject({
      route: 'review-analysis',
      operationId: UUIDS.operation,
      permitId: UUIDS.permit,
      attemptNumber: 2,
      deadlineEpochMillis: NOW + 70_000,
    })
    expect(options).toMatchObject({ deadlineEpochMillis: NOW + 70_000 })
    for (const forbidden of [
      'descriptor',
      'sourceDigest',
      'preparedDigest',
      'requestBindingHmac',
      'preparedPayload',
    ]) {
      expect(sent).not.toHaveProperty(forbidden)
    }
    expect(bytes.every((byte: number) => byte === 0)).toBe(true)
  })

  it('enforces the caller certificate route matrix before transport', async () => {
    const fake = transportReturning(successResponse())
    const web = createAiGatewayAdapter({
      transport: fake.transport,
      caller: 'web',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    await expect(
      web.analyzeReview(analysisInput(), new AbortController().signal),
    ).rejects.toThrow(/caller is not authorized/)
    expect(fake.postBytesRaw).not.toHaveBeenCalled()
  })

  it('returns operation ambiguity for reply results bound to another language, group, or base reply revision', async () => {
    for (const result of [
      {
        concreteLanguageTag: 'es-Latn',
        templateGroup: 'en-Latn',
        baseReplyStateRevision: 7,
      },
      {
        concreteLanguageTag: 'en-Latn',
        templateGroup: 'es-Latn',
        baseReplyStateRevision: 7,
      },
      {
        concreteLanguageTag: 'en-Latn',
        templateGroup: 'en-Latn',
        baseReplyStateRevision: 8,
      },
    ]) {
      const fake = transportReturning(replySuccessResponse(result))
      const adapter = createAiGatewayAdapter({
        transport: fake.transport,
        caller: 'web',
        admissionSettlementPublicKeys: settlementPublicKeys,
        nowEpochMillis: () => NOW,
      })
      await expect(
        adapter.generateReply(replyInput(), new AbortController().signal),
      ).resolves.toMatchObject({ status: 'error', code: 'operation_ambiguous' })
      expect(fake.retainedBodies[0]!.every((byte) => byte === 0)).toBe(true)
    }
  })

  it('returns operation ambiguity for an out-of-request trend selection', async () => {
    const input = trendInput()
    const candidateIds = new Set(input.source.candidates.map(({ id }) => id))
    const unrelated = CLOSED_TREND_SIGNAL_IDS.find((id) => !candidateIds.has(id))
    expect(unrelated).toBeDefined()
    const fake = transportReturning(trendSuccessResponse([unrelated!]))
    const adapter = createAiGatewayAdapter({
      transport: fake.transport,
      caller: 'worker',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    await expect(
      adapter.generateTrend(input, new AbortController().signal),
    ).resolves.toMatchObject({ status: 'error', code: 'operation_ambiguous' })
    expect(fake.retainedBodies[0]!.every((byte) => byte === 0)).toBe(true)
  })

  it.each([NOW, NOW - 1, NOW + 70_001, Number.MAX_SAFE_INTEGER])(
    'rejects invalid analysis deadline %s before transport',
    async (deadline) => {
      const fake = transportReturning(successResponse())
      const adapter = createAiGatewayAdapter({
        transport: fake.transport,
        caller: 'worker',
        admissionSettlementPublicKeys: settlementPublicKeys,
        nowEpochMillis: () => NOW,
      })
      await expect(
        adapter.analyzeReview(analysisInput(deadline), new AbortController().signal),
      ).rejects.toThrow(/deadline is invalid/)
      expect(fake.postBytesRaw).not.toHaveBeenCalled()
    },
  )
  it('rejects an encoded review envelope above 65,536 bytes before transport', async () => {
    const fake = transportReturning(successResponse())
    const adapter = createAiGatewayAdapter({
      transport: fake.transport,
      caller: 'worker',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    const input = analysisInput()
    await expect(
      adapter.analyzeReview(
        {
          ...input,
          source: { ...input.source, text: 'x'.repeat(65_536) },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/route bound/)
    expect(fake.postBytesRaw).not.toHaveBeenCalled()
  })

  it.each([
    ['success', successResponse()],
    [
      'denial',
      response({
        route: 'review-analysis',
        status: 'error',
        code: 'execution_suspended',
        retryAfterEpochMillis: null,
      }),
    ],
    ['transport failure', new Error('private transport failure')],
  ])('zeroes caller-owned serialized source bytes after %s', async (_label, value) => {
    const fake = transportReturning(value as InternalMtlsRawResponse | Error)
    const adapter = createAiGatewayAdapter({
      transport: fake.transport,
      caller: 'worker',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    await adapter
      .analyzeReview(analysisInput(), new AbortController().signal)
      .catch(() => undefined)
    expect(fake.retainedBodies).toHaveLength(1)
    expect(fake.retainedBodies[0]!.every((byte) => byte === 0)).toBe(true)
  })

  it('cleans up and performs no transport work for a pre-aborted request', async () => {
    const fake = transportReturning(successResponse())
    const adapter = createAiGatewayAdapter({
      transport: fake.transport,
      caller: 'worker',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      adapter.analyzeReview(analysisInput(), controller.signal),
    ).rejects.toThrow(/aborted/)
    expect(fake.postBytesRaw).not.toHaveBeenCalled()
  })
  it('zeroes caller-owned source bytes when an in-flight request aborts', async () => {
    const controller = new AbortController()
    let retainedBody: Uint8Array | null = null
    const transport: AiGatewayByteTransport = {
      async postBytesRaw(_path, body) {
        retainedBody = body
        controller.abort()
        throw new Error('aborted transport')
      },
    }
    const adapter = createAiGatewayAdapter({
      transport,
      caller: 'worker',
      admissionSettlementPublicKeys: settlementPublicKeys,
      nowEpochMillis: () => NOW,
    })
    const result = await adapter.analyzeReview(analysisInput(), controller.signal)
    expect(result).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
    expect(retainedBody).not.toBeNull()
    expect(retainedBody!.every((byte) => byte === 0)).toBe(true)
  })

  it('maps every untrusted post-dispatch response failure to operation ambiguity and zeroes bytes', async () => {
    const forgedSigningKeys = generateKeyPairSync('ed25519')
    const { receiptSignature: _signature, ...unsignedReceipt } = receipt
    const forgedReceipt = signAiSettlementReceipt(
      unsignedReceipt,
      forgedSigningKeys.privateKey,
    )
    const invalidResponses = [
      response({
        route: 'property-trend',
        status: 'error',
        code: 'provider_unavailable',
        retryAfterEpochMillis: null,
      }),
      response({
        route: 'review-analysis',
        status: 'error',
        code: 'provider_unavailable',
        retryAfterEpochMillis: null,
        providerRequestId: 'forbidden',
      }),
      successResponse(forgedReceipt),
      {
        status: 502,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new TextEncoder().encode('{"code":"provider_unavailable"}'),
      },
      {
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        }),
        body: new TextEncoder().encode('{}'),
      },
      {
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: new TextEncoder().encode('{}'),
      },
      {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new Uint8Array(65_537),
      },
    ] satisfies InternalMtlsRawResponse[]

    for (const invalid of invalidResponses) {
      const fake = transportReturning(invalid)
      const adapter = createAiGatewayAdapter({
        transport: fake.transport,
        caller: 'worker',
        admissionSettlementPublicKeys: settlementPublicKeys,
        nowEpochMillis: () => NOW,
      })
      await expect(
        adapter.analyzeReview(analysisInput(), new AbortController().signal),
      ).resolves.toMatchObject({ status: 'error', code: 'operation_ambiguous' })
      expect(invalid.body.every((byte) => byte === 0)).toBe(true)
    }
  })
})
