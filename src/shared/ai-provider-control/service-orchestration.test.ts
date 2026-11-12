import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import type {
  AiAdmissionDescriptorV1,
  AiSettlementPermit,
  AiSettlementOutcome,
  AiSettlementReceiptV1,
} from '#/shared/ai-internal-transport-contract'
import {
  parseAiGatewayRouteRequest,
  type AiGatewayRouteRequestV1,
} from '#/shared/ai-gateway-transport-contract'
import { analysisRequest } from '#/shared/ai-gateway-transport-contract.test-fixtures'
import type {
  AiAdmissionClient,
  AiGatewayRoutePreparer,
  OpenAiConnector,
  OpenAiConnectorOutcome,
  PreparedGatewayRouteExecution,
} from './contracts'
import { settlementPermitOf, type AiExecutionAdmission } from './execution-admission'
import { admitForTest } from './execution-admission.test-fixtures'
import { createAiEgressGatewayService } from './service'
import { createSensitiveSourceLease } from './source-lease'
import { settledCostMicros } from '#/shared/ai-openai-provider-profile'

const NOW = 1_780_000_000_000
const SHA = 'a'.repeat(64)

// The live review-analysis request (v3 form): the gateway's orchestration does not
// care which form it carries, but only a binding the catalogue serves parses.
function routeRequest(): AiGatewayRouteRequestV1 {
  return parseAiGatewayRouteRequest(analysisRequest())
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
      costMicros: 250_000,
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
            urgencySignals: [],
            aspects: [{ aspect: 'service', polarity: 'positive', intensity: 80 }],
            issueLabel: null,
          },
          settlementReceipt: receipt,
        }),
      }
    },
  }
}

function admitted(
  descriptor: AiAdmissionDescriptorV1,
  issued: Parameters<typeof admitForTest>[1] = {},
): AiExecutionAdmission {
  return admitForTest(descriptor, { issuedAtEpochMillis: NOW, ...issued })
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

function settledReceipt(
  request: AiSettlementPermit & AiSettlementOutcome,
  admission: AiExecutionAdmission,
): AiSettlementReceiptV1 {
  return {
    version: 'ai-settlement-receipt-v1',
    operationId: request.operationId,
    permitId: request.permitId,
    attemptNumber: request.attemptNumber,
    disposition: request.disposition,
    reportedDisposition: request.reportedDisposition,
    providerRetryable: request.providerRetryable,
    usageKnown: request.usageKnown,
    inputTokens: request.inputTokens,
    cachedInputTokens: request.cachedInputTokens,
    outputTokens: request.outputTokens,
    reasoningTokens: request.reasoningTokens,
    // Derived from the catalogue, not frozen: this fixture's fake authority
    // is the only thing standing in for real settlement pricing, and a frozen
    // number here is why a repricing shipped green.
    costMicros:
      request.disposition === 'no_dispatch'
        ? 0
        : request.usageKnown
          ? Number(settledCostMicros(request))
          : admission.limits.costMicros,
    settledAtEpochMillis: NOW + 2_000,
    settlementState:
      request.disposition === 'no_dispatch'
        ? 'released'
        : request.disposition === 'transport_ambiguous'
          ? 'ambiguous'
          : 'settled',
  }
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
    admission?: AiExecutionAdmission
    settle?: AiAdmissionClient['settle']
  }> = {},
) {
  const request = routeRequest()
  const prepared = preparedExecution(request)
  const minted = input.admission ?? admitted(prepared.invocation.descriptor)
  const prepare = vi.fn(() => prepared)
  const invoke = vi.fn(async () => successOutcome)
  const authorize = vi.fn(async () => ({
    status: 'authorized' as const,
    admission: minted,
  }))
  const settle = vi.fn<AiAdmissionClient['settle']>(
    input.settle ??
      (async (admission, outcome) => ({
        status: 'settled' as const,
        receipt: settledReceipt(
          { ...settlementPermitOf(admission), ...outcome },
          admission,
        ),
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
    now: () => NOW + 1_000,
  })
  return {
    request,
    prepared,
    minted,
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
  it('passes the admitted permit and provider outcome separately to settlement', async () => {
    const value = harness()
    await value.service.execute(sourceLease(value.request), new AbortController().signal)
    expect(value.settle).toHaveBeenCalledWith(
      value.minted,
      expect.objectContaining({
        disposition: 'success',
        inputTokens: 1,
        outputTokens: 1,
      }),
      expect.any(AbortSignal),
    )
  })

  it('disposes source before authorization and releases output only after authority settlement', async () => {
    const value = harness()
    value.authorize.mockImplementation(async () => {
      expect(value.request.source).toEqual({
        kind: null,
        text: null,
        rating: null,
        languageCode: null,
        reviewedAtEpochMillis: null,
        sentences: null,
      })
      return { status: 'authorized', admission: value.minted }
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
      'another operation',
      (descriptor: AiAdmissionDescriptorV1) =>
        admitted({ ...descriptor, operationId: '10000000-0000-4000-8000-000000000009' }),
    ],
    [
      'another descriptor',
      (descriptor: AiAdmissionDescriptorV1) =>
        admitted({ ...descriptor, sourceDigest: 'b'.repeat(64) }),
    ],
    [
      'copied (never minted)',
      (descriptor: AiAdmissionDescriptorV1) => ({ ...admitted(descriptor) }),
    ],
    [
      'another deadline',
      (descriptor: AiAdmissionDescriptorV1) =>
        admitted(
          { ...descriptor, callerDeadlineEpochMillis: NOW + 500 },
          { issuedAtEpochMillis: NOW },
        ),
    ],
  ])('withholds dispatch for an admission for %s', async (_name, makeAdmission) => {
    const request = routeRequest()
    const descriptor = descriptorFor(request)
    const value = harness({ admission: makeAdmission(descriptor) })
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

  it.each([
    ['another operation', { operationId: '10000000-0000-4000-8000-000000000009' }],
    ['another permit', { permitId: '10000000-0000-4000-8000-000000000009' }],
    ['another attempt', { attemptNumber: 2 }],
    ['different usage', { inputTokens: 2 }],
    ['invalid cost', { costMicros: -1 }],
    ['invalid state', { settlementState: 'released' }],
  ] satisfies readonly (readonly [string, Partial<AiSettlementReceiptV1>])[])(
    'withholds output when settlement returns %s',
    async (_name, mutation) => {
      const value = harness()
      value.settle.mockImplementation(async (admission, outcome) => ({
        status: 'settled',
        receipt: {
          ...settledReceipt({ ...settlementPermitOf(admission), ...outcome }, admission),
          ...mutation,
        },
      }))
      const response = await value.service.execute(
        sourceLease(value.request),
        new AbortController().signal,
      )
      expect(response).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
      expect(JSON.stringify(response)).not.toContain('sentiment')
      expect(value.invoke).toHaveBeenCalledOnce()
      expect(value.settle).toHaveBeenCalledOnce()
    },
  )

  it('withholds delivery when the authority settles after the permit deadline', async () => {
    const value = harness()
    value.settle.mockImplementation(async (admission, outcome) => ({
      status: 'settled',
      receipt: {
        ...settledReceipt({ ...settlementPermitOf(admission), ...outcome }, admission),
        settledAtEpochMillis: admission.expiresAtEpochMillis,
      },
    }))
    const response = await value.service.execute(
      sourceLease(value.request),
      new AbortController().signal,
    )
    expect(response).toMatchObject({
      status: 'error',
      code: 'completed_without_delivery',
    })
    expect(JSON.stringify(response)).not.toContain('sentiment')
    expect(value.invoke).toHaveBeenCalledOnce()
    expect(value.settle).toHaveBeenCalledOnce()
  })

  // Complete status refusals have known zero usage and retain their retry codes.
  it.each([
    ['rate_limited', true, 20, 'provider_rate_limited'],
    ['quota_exhausted', false, null, 'quota_exhausted'],
    ['provider_unavailable', true, null, 'provider_unavailable'],
  ] as const)(
    'names a provider refusal by status (%s) after its zero-cost settlement binds',
    async (disposition, providerRetryable, retryAfterSeconds, code) => {
      const value = harness()
      value.invoke.mockResolvedValue({
        disposition,
        reportedDisposition: disposition,
        result: null,
        usageKnown: true,
        providerRetryable,
        usage: {
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        },
        retryAfterSeconds,
        outboundFetchUsed: true,
      })

      const response = await value.service.execute(
        sourceLease(value.request),
        new AbortController().signal,
      )

      expect(response).toMatchObject({ status: 'error', code })
      expect(value.settle).toHaveBeenCalledWith(
        value.minted,
        expect.objectContaining({ disposition, usageKnown: true }),
        expect.anything(),
      )
    },
  )

  // A 400 or a 401 keeps unknown usage: the receipt now binds at the reservation,
  // and the caller must still hear `operation_ambiguous`, not `provider_refused`
  // (which ends the operation) or `provider_unavailable` (which retries unbudgeted).
  it.each([
    ['deadline_exceeded', 'deadline_exceeded'],
    ['provider_unavailable', 'provider_unavailable'],
    ['provider_refused', 'provider_refused'],
    ['output_invalid', 'success'],
    ['transport_ambiguous', 'transport_ambiguous'],
  ] as const)(
    'keeps unknown usage ambiguous after reservation-cost settlement (%s)',
    async (disposition, reportedDisposition) => {
      const value = harness()
      value.invoke.mockResolvedValue({
        disposition,
        reportedDisposition,
        result: null,
        usageKnown: false,
        providerRetryable: false,
        usage: {
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        },
        retryAfterSeconds: null,
        outboundFetchUsed: true,
      })

      const response = await value.service.execute(
        sourceLease(value.request),
        new AbortController().signal,
      )

      expect(response).toMatchObject({ status: 'error', code: 'operation_ambiguous' })
      expect(value.settle).toHaveBeenCalledTimes(1)
      expect(value.settle).toHaveBeenCalledWith(
        value.minted,
        expect.objectContaining({ disposition, usageKnown: false }),
        expect.anything(),
      )
    },
  )

  // Closed beta, 2026-09-29: during an import burst the admission authority's
  // database waited past its lock timeout. Nothing had been granted or
  // dispatched, but the gateway answered `operation_ambiguous`, which the
  // analysis retry counts against its four provider attempts.
  it('reports an admission authority that could not answer as unavailable, not ambiguous', async () => {
    const value = harness()
    value.authorize.mockRejectedValue(new Error('AI admission authority is unavailable'))

    const response = await value.service.execute(
      sourceLease(value.request),
      new AbortController().signal,
    )

    expect(response).toMatchObject({ status: 'error', code: 'provider_unavailable' })
    expect(value.invoke).not.toHaveBeenCalled()
    expect(value.settle).not.toHaveBeenCalled()
    expect(
      value.prepared.invocation.canonicalProviderBytes.every((byte) => byte === 0),
    ).toBe(true)
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
