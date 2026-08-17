import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  signAiExecutionGrant,
  signAiSettlementReceipt,
  type AiAdmissionDescriptorV1,
  type AiExecutionGrantV1,
  type AiSettlementRequestV1,
} from '../../src/shared/ai-internal-transport-contract'
import {
  parseAiGatewayRouteRequest,
  type AiGatewayRouteRequestV1,
} from '../../src/shared/ai-gateway-transport-contract'
import { MERCHANT_AI_NOTICE_DIGEST } from '../../src/shared/merchant-ai-notice-contract'
import type {
  AiAdmissionClient,
  AiGatewayRoutePreparer,
  OpenAiConnector,
  OpenAiConnectorOutcome,
  PreparedGatewayRouteExecution,
} from './contracts'
import { createAiEgressGatewayService } from './service'
import { createSensitiveSourceLease } from './source-lease'

const NOW = 1_780_000_000_000
const SHA = 'a'.repeat(64)
const OPERATION_ID = '10000000-0000-4000-8000-000000000001'
const PERMIT_ID = '10000000-0000-4000-8000-000000000002'
const REQUEST_BINDING_HMAC = Buffer.alloc(32, 0x31).toString('base64url')
const signingKeys = generateKeyPairSync('ed25519')
const forgedKeys = generateKeyPairSync('ed25519')

function routeRequest(): AiGatewayRouteRequestV1 {
  return parseAiGatewayRouteRequest({
    route: 'review-analysis',
    operationId: OPERATION_ID,
    permitId: PERMIT_ID,
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
        globalControlId: '10000000-0000-4000-8000-000000000006',
        globalGeneration: 1,
        providerControlId: '10000000-0000-4000-8000-000000000007',
        providerGeneration: 1,
        capabilityControlId: '10000000-0000-4000-8000-000000000008',
        capabilityGeneration: 1,
      },
    },
    deadlineEpochMillis: NOW + 70_000,
    redactionCountry: 'US',
    observedContentExpiresAtEpochMillis: NOW + 600_000,
    source: {
      kind: 'review',
      text: 'A bounded synthetic review.',
      rating: 5,
      languageCode: 'en-Latn',
      reviewedAtEpochMillis: NOW,
    },
  })
}

function descriptorFor(request: AiGatewayRouteRequestV1): AiAdmissionDescriptorV1 {
  if (request.route !== 'review-analysis') throw new Error('Expected analysis request')
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: request.route,
    operationId: request.operationId,
    permitId: request.permitId,
    attemptNumber: request.attemptNumber,
    sourceDigest: SHA,
    preparedDigest: 'b'.repeat(64),
    sourceByteCount: 32,
    preparedByteCount: 256,
    providerPayloadByteCount: 64,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 16_384,
      providerPayloadBytes: 16_384,
      preparedRequestBytes: 65_536,
      responseBytes: 131_072,
      outputTokens: 4_096,
      costMicros: 100_000,
    },
    callerDeadlineEpochMillis: request.deadlineEpochMillis,
    organizationId: request.organizationId,
    propertyId: request.propertyId,
    internalSubjectId: request.internalSubjectId,
    binding: request.binding,
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    redactionProfileVersion: request.binding.redactionProfileVersion,
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
    actorId: null,
    observedContentExpiresAtEpochMillis: request.observedContentExpiresAtEpochMillis,
    redactionCountry: request.redactionCountry,
  }
}

function preparedExecution(
  request: AiGatewayRouteRequestV1,
): PreparedGatewayRouteExecution {
  const descriptor = descriptorFor(request)
  return {
    invocation: {
      descriptor,
      requestBindingKeyId: 'request-v1',
      requestBindingHmac: REQUEST_BINDING_HMAC,
      sdkRequest: {} as never,
      canonicalProviderBytes: Buffer.from('prepared-provider-body'),
    } as never,
    outputSchema: z.object({ accepted: z.literal(true) }).strict(),
    acceptProviderResult: (value) => {
      const parsed = z
        .object({ accepted: z.literal(true) })
        .strict()
        .safeParse(value)
      if (!parsed.success) return null
      return {
        buildResponse: (receipt) => ({
          route: 'review-analysis',
          status: 'success',
          result: {
            sentiment: 'positive',
            sentimentValence: 80,
            primaryCategory: 'service',
            urgencySignals: [],
          },
          settlementReceipt: receipt,
        }),
      }
    },
  }
}

function signedGrant(
  descriptor: AiAdmissionDescriptorV1,
  privateKey = signingKeys.privateKey,
  mutation: Partial<AiExecutionGrantV1> = {},
): AiExecutionGrantV1 {
  return signAiExecutionGrant(
    {
      version: 'ai-execution-grant-v1',
      subjectKind: descriptor.subjectKind,
      grantKid: 'grant-v1',
      requestBindingKeyId: 'request-v1',
      requestBindingHmac: REQUEST_BINDING_HMAC,
      route: descriptor.route,
      operationId: descriptor.operationId,
      permitId: descriptor.permitId,
      attemptNumber: descriptor.attemptNumber,
      nonce: Buffer.alloc(32, 0x41).toString('base64url'),
      limits: descriptor.limits,
      callerDeadlineEpochMillis: descriptor.callerDeadlineEpochMillis,
      issuedAtEpochMillis: NOW,
      expiresAtEpochMillis: descriptor.callerDeadlineEpochMillis,
      replyTokenExpiresAtEpochMillis: null,
      replyDraftExpiresAtEpochMillis: null,
      ...mutation,
    },
    privateKey,
  )
}

const successOutcome: OpenAiConnectorOutcome<unknown> = {
  disposition: 'success',
  reportedDisposition: 'success',
  result: { accepted: true },
  usageKnown: true,
  providerRetryable: false,
  usage: {
    inputTokens: 1,
    cachedTokens: 0,
    outputTokens: 1,
    reasoningTokens: 0,
    totalTokens: 2,
  },
  retryAfterSeconds: null,
  outboundFetchUsed: true,
}

function signedSuccessReceipt(request: AiSettlementRequestV1, grant: AiExecutionGrantV1) {
  return signAiSettlementReceipt(
    {
      version: 'ai-settlement-receipt-v1',
      receiptKid: 'grant-v1',
      grantKid: grant.grantKid,
      operationId: request.operationId,
      permitId: request.permitId,
      attemptNumber: request.attemptNumber,
      nonce: request.nonce,
      requestBindingHmac: grant.requestBindingHmac,
      disposition: request.disposition,
      reportedDisposition: request.reportedDisposition,
      providerRetryable: request.providerRetryable,
      usageKnown: request.usageKnown,
      inputTokens: request.inputTokens,
      cachedInputTokens: request.cachedInputTokens,
      outputTokens: request.outputTokens,
      reasoningTokens: request.reasoningTokens,
      costMicros: 6,
      settledAtEpochMillis: NOW + 2_000,
      settlementState: 'settled',
    },
    signingKeys.privateKey,
  )
}

function sourceLease(request: AiGatewayRouteRequestV1) {
  const lease = createSensitiveSourceLease<AiGatewayRouteRequestV1>()
  if (request.route === 'property-trend')
    throw new Error('Expected source-bearing request')
  lease.attachSource(request, (root) => root.source)
  return lease
}

function harness(
  input: Readonly<{
    grant?: AiExecutionGrantV1
    settle?: AiAdmissionClient['settle']
  }> = {},
) {
  const request = routeRequest()
  const prepared = preparedExecution(request)
  const grant = input.grant ?? signedGrant(prepared.invocation.descriptor)
  const prepare = vi.fn(() => prepared)
  const invoke = vi.fn(async () => successOutcome)
  const authorize = vi.fn(async () => ({ status: 'authorized' as const, grant }))
  const settle = vi.fn(
    input.settle ??
      (async (settlementRequest) => ({
        status: 'settled' as const,
        receipt: signedSuccessReceipt(settlementRequest, grant),
      })),
  )
  const connector = {
    invoke,
    readiness: vi.fn(() => true),
  } as unknown as OpenAiConnector
  const admission = {
    authorize,
    settle,
    readiness: vi.fn(async () => true),
  } as AiAdmissionClient
  const service = createAiEgressGatewayService({
    admission,
    connector,
    preparer: { prepare } as AiGatewayRoutePreparer,
    admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
    now: () => NOW + 1_000,
  })
  return {
    request,
    prepared,
    grant,
    prepare,
    invoke,
    authorize,
    settle,
    connector,
    admission,
    service,
  }
}

describe('AI gateway execution orchestration', () => {
  it('disposes source before authorization and releases output only after a signed settlement', async () => {
    const value = harness()
    value.authorize.mockImplementation(async () => {
      expect(value.request.source).toEqual({
        kind: null,
        text: null,
        rating: null,
        languageCode: null,
        reviewedAtEpochMillis: null,
      })
      return { status: 'authorized', grant: value.grant }
    })

    const response = await value.service.execute(
      sourceLease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({
      route: 'review-analysis',
      status: 'success',
      result: { sentiment: 'positive' },
    })
    expect(value.authorize).toHaveBeenCalledTimes(1)
    expect(value.invoke).toHaveBeenCalledTimes(1)
    expect(value.settle).toHaveBeenCalledTimes(1)
    expect(value.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      value.invoke.mock.invocationCallOrder[0]!,
    )
    expect(value.invoke.mock.invocationCallOrder[0]).toBeLessThan(
      value.settle.mock.invocationCallOrder[0]!,
    )
  })

  it.each([
    [
      'signed tuple swap',
      (descriptor: AiAdmissionDescriptorV1) =>
        signedGrant(descriptor, signingKeys.privateKey, {
          operationId: '10000000-0000-4000-8000-000000000009',
        }),
    ],
    [
      'forged signature',
      (descriptor: AiAdmissionDescriptorV1) =>
        signedGrant(descriptor, forgedKeys.privateKey),
    ],
  ])('withholds dispatch for a %s grant', async (_name, makeGrant) => {
    const request = routeRequest()
    const descriptor = descriptorFor(request)
    const value = harness({ grant: makeGrant(descriptor) })
    const response = await value.service.execute(
      sourceLease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
    expect(value.invoke).not.toHaveBeenCalled()
    expect(value.settle).not.toHaveBeenCalled()
  })

  it.each([
    [
      'dropped settlement',
      async () => {
        throw new Error('dropped')
      },
    ],
    [
      'denied settlement',
      async () => ({ status: 'denied' as const, code: 'settlement_conflict' as const }),
    ],
  ])('withholds a successful provider result after %s', async (_name, settle) => {
    const value = harness({ settle })
    const response = await value.service.execute(
      sourceLease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
    expect(JSON.stringify(response)).not.toContain('sentiment')
    expect(value.invoke).toHaveBeenCalledTimes(1)
    expect(value.settle).toHaveBeenCalledTimes(1)
  })

  it('uses provider-free readiness checks only', async () => {
    const value = harness()
    await expect(value.service.readiness(new AbortController().signal)).resolves.toBe(
      true,
    )
    expect(value.connector.readiness).toHaveBeenCalledTimes(1)
    expect(value.admission.readiness).toHaveBeenCalledTimes(1)
    expect(value.prepare).not.toHaveBeenCalled()
    expect(value.invoke).not.toHaveBeenCalled()
    expect(value.authorize).not.toHaveBeenCalled()
    expect(value.settle).not.toHaveBeenCalled()
  })
})
