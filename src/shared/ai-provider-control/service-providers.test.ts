// The gateway service meets the provider seam: a call goes to the adapter of the
// provider that prepared it, is priced by that provider's list, and when that
// provider fails the answer is the failure, never a call to the other one. The
// orchestration around the call (grant, settlement, deadlines) is
// `service-orchestration.test.ts`, which still passes unchanged on the legacy
// single-connector wiring; this file shows the registry wiring agrees with it.

import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import {
  signAiExecutionGrant,
  signAiSettlementReceipt,
  type AiAdmissionDescriptorV1,
  type AiExecutionGrantV1,
  type AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import {
  parseAiGatewayRouteRequest,
  type AiGatewayRouteRequestV1,
} from '#/shared/ai-gateway-transport-contract'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { OPENAI_PRICE_CATALOGUE_V1 } from '#/shared/ai-openai-provider-profile'
import {
  settledCostMicrosWith,
  type AiProviderPriceCatalogue,
} from '#/shared/ai-provider-pricing'
import type {
  AiAdmissionClient,
  AiGatewayRoutePreparer,
  OpenAiConnector,
  OpenAiConnectorOutcome,
  PreparedGatewayRouteExecution,
} from './contracts'
import type { AiProviderAdapter, AiProviderId } from './provider-contracts'
import { createAiProviderRegistry } from './provider-selection'
import { createAiEgressGatewayService } from './service'
import { createSensitiveSourceLease } from './source-lease'

const NOW = 1_780_000_000_000
const SHA = 'a'.repeat(64)
const REQUEST_BINDING_HMAC = Buffer.alloc(32, 0x31).toString('base64url')
const signingKeys = generateKeyPairSync('ed25519')

const SECOND_PRICES: AiProviderPriceCatalogue = Object.freeze({
  ...OPENAI_PRICE_CATALOGUE_V1,
  catalogueId: 'synthetic-second-provider-prices',
  uncachedInputMicros: 3_000_000,
  cachedInputMicros: 300_000,
  outputMicros: 15_000_000,
})

function routeRequest(): AiGatewayRouteRequestV1 {
  return parseAiGatewayRouteRequest({
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
      operationProfileVersion: 'review-analysis-v2',
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
  providerId?: AiProviderId,
): PreparedGatewayRouteExecution {
  return {
    ...(providerId === undefined ? {} : { providerId }),
    invocation: {
      descriptor: descriptorFor(request),
      requestBindingKeyId: 'request-v1',
      requestBindingHmac: REQUEST_BINDING_HMAC,
      sdkRequest: {} as never,
      canonicalProviderBytes: Buffer.from('prepared-provider-body'),
    } as never,
    outputSchema: z.object({ accepted: z.literal(true) }).strict(),
    acceptProviderResult: (value) =>
      z
        .object({ accepted: z.literal(true) })
        .strict()
        .safeParse(value).success
        ? {
            buildResponse: (receipt) => ({
              route: 'review-analysis',
              status: 'success',
              result: {
                sentiment: 'positive',
                sentimentValence: 80,
                urgencySignals: [],
                aspects: [{ aspect: 'service', polarity: 'positive', intensity: 80 }],
                issueLabel: null,
              },
              settlementReceipt: receipt,
            }),
          }
        : null,
  }
}

function signedGrant(descriptor: AiAdmissionDescriptorV1): AiExecutionGrantV1 {
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
    },
    signingKeys.privateKey,
  )
}

const usage = {
  inputTokens: 1_000,
  cachedTokens: 400,
  outputTokens: 200,
  reasoningTokens: 0,
  totalTokens: 1_200,
} as const

function outcomeOf(
  disposition: AiSettlementRequestV1['disposition'],
): OpenAiConnectorOutcome<unknown> {
  const succeeded = disposition === 'success'
  const unknownUsage =
    disposition === 'transport_ambiguous' || disposition === 'no_dispatch'
  return {
    disposition,
    reportedDisposition: disposition as never,
    result: succeeded ? { accepted: true } : null,
    usageKnown: !unknownUsage,
    providerRetryable:
      disposition === 'rate_limited' || disposition === 'provider_unavailable',
    usage: unknownUsage
      ? {
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        }
      : usage,
    retryAfterSeconds: null,
    outboundFetchUsed: disposition !== 'no_dispatch',
  }
}

/** The receipt an authority pricing the call with `pricing` would sign. */
function receiptFor(
  request: AiSettlementRequestV1,
  grant: AiExecutionGrantV1,
  pricing: AiProviderPriceCatalogue,
) {
  const cost =
    request.disposition === 'no_dispatch'
      ? 0
      : !request.usageKnown
        ? grant.limits.costMicros
        : Number(settledCostMicrosWith(pricing, request))
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
      costMicros: cost,
      settledAtEpochMillis: NOW + 2_000,
      settlementState:
        request.disposition === 'no_dispatch'
          ? 'released'
          : request.disposition === 'transport_ambiguous'
            ? 'ambiguous'
            : 'settled',
    },
    signingKeys.privateKey,
  )
}

function lease(request: AiGatewayRouteRequestV1) {
  const value = createSensitiveSourceLease<AiGatewayRouteRequestV1>()
  if (request.route === 'property-trend')
    throw new Error('Expected source-bearing request')
  value.attachSource(request, (root) => root.source)
  return value
}

type FakeAdapter = AiProviderAdapter &
  Readonly<{ invoke: ReturnType<typeof vi.fn>; readinessSpy: ReturnType<typeof vi.fn> }>

function fakeAdapter(
  providerId: AiProviderId,
  pricing: AiProviderPriceCatalogue,
  result: () => Promise<OpenAiConnectorOutcome<unknown>>,
  ready = true,
): FakeAdapter {
  const invoke = vi.fn(result)
  const readinessSpy = vi.fn(() => ready)
  return {
    providerId,
    requestProfile: {
      model: `${providerId}-model`,
      version: `${providerId}-profile`,
      digest: SHA,
    },
    pricing,
    prepare: () => {
      throw new Error('the service never prepares')
    },
    invoke,
    readiness: readinessSpy,
    readinessSpy,
  } as FakeAdapter
}

function run(
  input: Readonly<{
    wiring: (adapters: readonly FakeAdapter[]) => object
    adapters: readonly FakeAdapter[]
    preparedProvider?: AiProviderId
    pricing: AiProviderPriceCatalogue
  }>,
) {
  const request = routeRequest()
  const prepared = preparedExecution(request, input.preparedProvider)
  const grant = signedGrant(prepared.invocation.descriptor)
  const authorize = vi.fn(async () => ({ status: 'authorized' as const, grant }))
  const settle = vi.fn(async (settlement: AiSettlementRequestV1) => ({
    status: 'settled' as const,
    receipt: receiptFor(settlement, grant, input.pricing),
  }))
  const service = createAiEgressGatewayService({
    admission: {
      authorize,
      settle,
      readiness: vi.fn(async () => true),
    } as AiAdmissionClient,
    preparer: { prepare: () => prepared } as AiGatewayRoutePreparer,
    admissionPublicKeys: new Map([['grant-v1', signingKeys.publicKey]]),
    now: () => NOW + 1_000,
    ...input.wiring(input.adapters),
  } as never)
  return { request, prepared, grant, authorize, settle, service }
}

const registryWiring = (adapters: readonly FakeAdapter[]) => ({
  providers: createAiProviderRegistry(adapters),
})

describe('the registry wiring agrees with the single connector it replaces', () => {
  it('answers the same, makes the same call and settles the same for OpenAI', async () => {
    const legacyConnector = {
      invoke: vi.fn(async () => outcomeOf('success')),
      readiness: vi.fn(() => true),
    }
    const legacy = run({
      wiring: () => ({ connector: legacyConnector as unknown as OpenAiConnector }),
      adapters: [],
      pricing: OPENAI_PRICE_CATALOGUE_V1,
    })
    const openAi = fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
      outcomeOf('success'),
    )
    const registry = run({
      wiring: registryWiring,
      adapters: [openAi],
      pricing: OPENAI_PRICE_CATALOGUE_V1,
    })

    const legacyResponse = await legacy.service.execute(
      lease(legacy.request),
      new AbortController().signal,
    )
    const registryResponse = await registry.service.execute(
      lease(registry.request),
      new AbortController().signal,
    )

    expect(registryResponse).toEqual(legacyResponse)
    expect(registryResponse).toMatchObject({ status: 'success' })
    expect(openAi.invoke).toHaveBeenCalledTimes(1)
    expect(legacyConnector.invoke).toHaveBeenCalledTimes(1)
    expect(openAi.invoke.mock.calls[0]?.slice(0, 3)).toEqual([
      registry.prepared.invocation,
      registry.grant,
      registry.prepared.outputSchema,
    ])
    expect(registry.settle).toHaveBeenCalledTimes(1)
  })

  it('needs exactly one of the two', () => {
    const base = {
      admission: {} as AiAdmissionClient,
      preparer: {} as AiGatewayRoutePreparer,
      admissionPublicKeys: new Map(),
    }

    expect(() => createAiEgressGatewayService(base as never)).toThrow(
      'the gateway needs a connector or a provider registry',
    )
    expect(() =>
      createAiEgressGatewayService({
        ...base,
        connector: { invoke: vi.fn() },
        providers: createAiProviderRegistry([]),
      } as never),
    ).toThrow('the gateway takes a connector or a provider registry, not both')
  })
})

describe('a call goes to the provider that prepared it, and is priced by that provider', () => {
  it('calls only the second provider, and settles at the second provider’s prices', async () => {
    const openAi = fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
      outcomeOf('success'),
    )
    const second = fakeAdapter('anthropic', SECOND_PRICES, async () =>
      outcomeOf('success'),
    )
    const value = run({
      wiring: registryWiring,
      adapters: [openAi, second],
      preparedProvider: 'anthropic',
      pricing: SECOND_PRICES,
    })

    const response = await value.service.execute(
      lease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'success' })
    expect(second.invoke).toHaveBeenCalledTimes(1)
    expect(openAi.invoke).not.toHaveBeenCalled()
  })

  it('does not accept a receipt priced by another provider’s list, however well signed', async () => {
    const second = fakeAdapter('anthropic', SECOND_PRICES, async () =>
      outcomeOf('success'),
    )
    const value = run({
      wiring: registryWiring,
      adapters: [
        fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
          outcomeOf('success'),
        ),
        second,
      ],
      preparedProvider: 'anthropic',
      // The authority priced it as OpenAI: the receipt cannot bind.
      pricing: OPENAI_PRICE_CATALOGUE_V1,
    })

    const response = await value.service.execute(
      lease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
  })

  it('refuses a provider this process holds no adapter for before it asks admission for anything', async () => {
    const openAi = fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
      outcomeOf('success'),
    )
    const value = run({
      wiring: registryWiring,
      adapters: [openAi],
      preparedProvider: 'anthropic',
      pricing: OPENAI_PRICE_CATALOGUE_V1,
    })

    const response = await value.service.execute(
      lease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'error', code: 'policy_unavailable' })
    expect(value.authorize).not.toHaveBeenCalled()
    expect(openAi.invoke).not.toHaveBeenCalled()
    expect(
      value.prepared.invocation.canonicalProviderBytes.every((byte) => byte === 0),
    ).toBe(true)
  })
})

describe('no fallback', () => {
  const dispositions = [
    'rate_limited',
    'provider_unavailable',
    'quota_exhausted',
    'provider_refused',
    'output_invalid',
    'output_truncated',
    'transport_ambiguous',
    'no_dispatch',
    'deadline_exceeded',
    'caller_aborted',
  ] as const

  it.each(dispositions)(
    'answers a %s from the chosen provider as one provider would, and calls no other',
    async (disposition) => {
      const alone = run({
        wiring: () => ({
          connector: {
            invoke: vi.fn(async () => outcomeOf(disposition)),
            readiness: vi.fn(() => true),
          } as unknown as OpenAiConnector,
        }),
        adapters: [],
        pricing: OPENAI_PRICE_CATALOGUE_V1,
      })
      const other = fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
        outcomeOf('success'),
      )
      const chosen = fakeAdapter('anthropic', OPENAI_PRICE_CATALOGUE_V1, async () =>
        outcomeOf(disposition),
      )
      const both = run({
        wiring: registryWiring,
        adapters: [other, chosen],
        preparedProvider: 'anthropic',
        pricing: OPENAI_PRICE_CATALOGUE_V1,
      })

      const aloneResponse = await alone.service.execute(
        lease(alone.request),
        new AbortController().signal,
      )
      const bothResponse = await both.service.execute(
        lease(both.request),
        new AbortController().signal,
      )

      expect(bothResponse).toEqual(aloneResponse)
      expect(chosen.invoke).toHaveBeenCalledTimes(1)
      expect(other.invoke).not.toHaveBeenCalled()
    },
  )

  it('turns a connection that throws into an ambiguous outcome and still calls no other provider', async () => {
    const other = fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
      outcomeOf('success'),
    )
    const chosen = fakeAdapter('anthropic', OPENAI_PRICE_CATALOGUE_V1, async () => {
      throw new Error('connection lost')
    })
    const value = run({
      wiring: registryWiring,
      adapters: [other, chosen],
      preparedProvider: 'anthropic',
      pricing: OPENAI_PRICE_CATALOGUE_V1,
    })

    const response = await value.service.execute(
      lease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
    expect(chosen.invoke).toHaveBeenCalledTimes(1)
    expect(other.invoke).not.toHaveBeenCalled()
  })
})

describe('readiness', () => {
  it('is the readiness of every adapter it holds and of admission', async () => {
    const ready = fakeAdapter('openai', OPENAI_PRICE_CATALOGUE_V1, async () =>
      outcomeOf('success'),
    )
    const unready = fakeAdapter(
      'anthropic',
      SECOND_PRICES,
      async () => outcomeOf('success'),
      false,
    )
    const admission = {
      readiness: vi.fn(async () => true),
    } as unknown as AiAdmissionClient
    const build = (adapters: readonly FakeAdapter[]) =>
      createAiEgressGatewayService({
        admission,
        preparer: {} as AiGatewayRoutePreparer,
        admissionPublicKeys: new Map(),
        providers: createAiProviderRegistry(adapters),
      })
    const signal = new AbortController().signal

    await expect(build([ready]).readiness(signal)).resolves.toBe(true)
    await expect(build([ready, unready]).readiness(signal)).resolves.toBe(false)
    await expect(build([unready]).readiness(signal)).resolves.toBe(false)
    const aborted = new AbortController()
    aborted.abort()
    await expect(build([ready]).readiness(aborted.signal)).resolves.toBe(false)
  })
})
