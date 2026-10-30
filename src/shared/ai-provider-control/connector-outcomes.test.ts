import { describe, expect, it, vi } from 'vitest'
import type { AiExecutionGrantV1 } from '#/shared/ai-internal-transport-contract'
import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  GrantNonceRegistry,
  type OneShotProviderFetchState,
  type ProviderBoundaryInvocation,
} from './connector-boundary'
import {
  outcomeOfProviderThrow,
  refusalAtProviderDispatchGate,
} from './connector-outcomes'

const invocation = {
  descriptor: {
    route: 'review-analysis',
    operationId: '10000000-0000-4000-8000-000000000001',
    permitId: '10000000-0000-4000-8000-000000000002',
    attemptNumber: 1,
  },
  canonicalProviderBytes: Uint8Array.of(1, 2, 3),
} as unknown as ProviderBoundaryInvocation

function state(overrides: Partial<OneShotProviderFetchState> = {}) {
  return {
    outboundFetchUsed: true,
    completeStatus: null,
    retryAfterSeconds: null,
    decodedResponseBytes: null,
    sdkRequestBytes: null,
    ...overrides,
  } satisfies OneShotProviderFetchState
}

class UnusableAnswer extends Error {}

function throwOutcome(
  overrides: Partial<Parameters<typeof outcomeOfProviderThrow>[0]> = {},
) {
  return outcomeOfProviderThrow({
    error: new Error('boom'),
    state: state(),
    pinnedAbsent: false,
    invocation,
    responseBytes: 4_096,
    signal: new AbortController().signal,
    classifyRefusal: () => ({
      disposition: 'quota_exhausted',
      providerRetryable: false,
      usageKnown: true,
      retryAfterSeconds: null,
    }),
    isInvalidOutput: (error) => error instanceof UnusableAnswer,
    usageOfDecodedBody: () => null,
    ...overrides,
  })
}

describe('what a provider call that threw came to', () => {
  it('reads a complete answer other than 200 as the provider classified it, at zero use', () => {
    const classify = vi.fn(() => ({
      disposition: 'rate_limited' as const,
      providerRetryable: true,
      usageKnown: true,
      retryAfterSeconds: 7,
    }))

    const outcome = throwOutcome({
      state: state({ completeStatus: 429, retryAfterSeconds: 7 }),
      classifyRefusal: classify,
    })

    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ completeStatus: 429 }),
      4_096,
    )
    expect(outcome).toMatchObject({
      disposition: 'rate_limited',
      providerRetryable: true,
      usageKnown: true,
      retryAfterSeconds: 7,
      outboundFetchUsed: true,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })
  })

  it.each([
    ['no one-shot fetch was ever built', null],
    ['the outbound fetch was never reached', state({ outboundFetchUsed: false })],
  ])('is no_dispatch, and says why, when %s', (_name, recorded) => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const outcome = throwOutcome({ state: recorded, pinnedAbsent: true })

    expect(outcome).toMatchObject({
      disposition: 'no_dispatch',
      outboundFetchUsed: false,
    })
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      event: 'gateway_no_dispatch',
      stage: 'dispatch_threw_before_outbound',
      pinnedNull: true,
      boundaryNull: recorded === null,
    })
    write.mockRestore()
  })

  it.each([
    ['provider_deadline', 'deadline_exceeded'],
    ['caller_gone', 'caller_aborted'],
  ])('names an aborted signal (%s) as %s', (reason, disposition) => {
    const controller = new AbortController()
    controller.abort(reason)

    expect(throwOutcome({ signal: controller.signal })).toMatchObject({
      disposition,
      usageKnown: false,
      outboundFetchUsed: true,
    })
  })

  it('is a billed-unknown output_invalid for the provider own unusable-answer class', () => {
    const onInvalidOutput = vi.fn()
    const usageOfDecodedBody = vi.fn()

    const outcome = throwOutcome({
      error: new UnusableAnswer(),
      state: state({ completeStatus: 200 }),
      onInvalidOutput,
      usageOfDecodedBody,
    })

    expect(outcome).toMatchObject({
      disposition: 'output_invalid',
      reportedDisposition: 'success',
      usageKnown: false,
    })
    expect(onInvalidOutput).toHaveBeenCalledTimes(1)
    expect(usageOfDecodedBody).not.toHaveBeenCalled()
  })

  it('keeps the usage still readable from a 200 body it could not interpret', () => {
    const usage = {
      inputTokens: 10,
      cachedTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
      totalTokens: 15,
    }
    const decoded = Uint8Array.of(123, 125)
    const onPost200Throw = vi.fn()

    const outcome = throwOutcome({
      state: state({ completeStatus: 200, decodedResponseBytes: decoded }),
      usageOfDecodedBody: (bytes) => (bytes === decoded ? usage : null),
      onPost200Throw,
    })

    expect(outcome).toMatchObject({
      disposition: 'output_invalid',
      usageKnown: true,
      usage,
    })
    expect(onPost200Throw).toHaveBeenCalledTimes(1)
  })

  it('prices an unreadable 200 as unknown rather than free', () => {
    expect(throwOutcome({ state: state({ completeStatus: 200 }) })).toMatchObject({
      disposition: 'output_invalid',
      usageKnown: false,
    })
  })

  it('is ambiguous when the call was sent and nothing came back', () => {
    expect(throwOutcome()).toMatchObject({
      disposition: 'transport_ambiguous',
      usageKnown: false,
      outboundFetchUsed: true,
    })
  })
})

describe('the gate before a provider call', () => {
  const grant = {
    nonce: 'n',
    permitId: '10000000-0000-4000-8000-000000000002',
    issuedAtEpochMillis: 0,
    expiresAtEpochMillis: 10_000,
    limits: {},
  } as unknown as AiExecutionGrantV1
  const keys = {} as unknown as VersionedHmacKeyring

  it('refuses, names the crash and zeroes the bytes when the attestation throws', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const bytes = Uint8Array.of(1, 2, 3)

    const outcome = refusalAtProviderDispatchGate({
      invocation: { ...invocation, canonicalProviderBytes: bytes },
      grant,
      requestBindingKeys: keys,
      admissionPublicKeys: new Map(),
      nonceRegistry: new GrantNonceRegistry(),
      now: () => 1_000,
    })

    expect(outcome).toMatchObject({
      disposition: 'no_dispatch',
      outboundFetchUsed: false,
    })
    expect(bytes).toEqual(Uint8Array.of(0, 0, 0))
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      event: 'gateway_no_dispatch',
      stage: 'attestation_threw',
    })
    write.mockRestore()
  })

  it('refuses when the clock itself fails, rather than letting the call through', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const outcome = refusalAtProviderDispatchGate({
      invocation: { ...invocation, canonicalProviderBytes: Uint8Array.of(9) },
      grant,
      requestBindingKeys: keys,
      admissionPublicKeys: new Map(),
      nonceRegistry: new GrantNonceRegistry(),
      now: () => {
        throw new Error('clock unavailable')
      },
    })

    expect(outcome).toMatchObject({ disposition: 'no_dispatch' })
    write.mockRestore()
  })
})
